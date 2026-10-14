const express = require('express');
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const {
  initDB, insertSurvey, saveDraft, submitSurvey, getSurveys, getSurveyById,
  getSurveyByCode, getAllSurveysBatch, deleteSurvey, deleteSurveys, updateSurveyById,
  createInviteCode, getInviteCodes, verifyInviteCode, deleteInviteCode, toggleInviteCode
} = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 信任代理（Render 等平台通过 X-Forwarded-For 传递真实客户端 IP）
app.set('trust proxy', 1);

// ========== 安全响应头（新增 CSP，修复 S3）==========
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP：第三方库已本地化，限制脚本仅来自自身；内联脚本因表单/后台使用 onclick 等保留 unsafe-inline
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'"
  );
  next();
});

// CORS：前端页面与 API 同源部署，禁用跨域请求
app.use(cors({ origin: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== 启动前强制检查：必须设置管理员密码 ==========
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) {
  console.error('❌ 启动失败：必须设置 ADMIN_PASSWORD 环境变量，且长度不少于 8 位');
  console.error('   请勿使用默认弱密码，请到 Render 环境变量中配置强密码后重新部署');
  process.exit(1);
}

initDB().catch(err => {
  console.error('数据库初始化失败，服务退出:', err.message);
  process.exit(1);
});

// ========== 工具函数 ==========

// HTML 转义（防止邮件/页面中的注入）
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 统一服务器错误响应（不向客户端泄露内部错误细节；日志脱敏，修复 S7）
function serverError(res, err, context) {
  // 只记录错误类型和消息，不打印完整 err 对象（避免泄露用户数据 / 连接字符串）
  console.error(`[${context}] ${err.name || 'Error'}: ${err.message}`);
  if (err.code) console.error(`[${context}] code: ${err.code}`);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
}

// ========== 通用速率限制中间件（修复 S1：公开接口限流）==========
function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  // 定期清理过期记录
  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (now - rec.firstTime >= windowMs) hits.delete(ip);
    }
  }, 60 * 1000);

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now - rec.firstTime >= windowMs) {
      rec = { count: 0, firstTime: now };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > maxRequests) {
      const retryAfter = Math.ceil((windowMs - (now - rec.firstTime)) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: `请求过于频繁，请 ${retryAfter} 秒后再试` });
    }
    next();
  };
}

// 公开接口限流：每 IP 每分钟 30 次
const publicApiLimiter = createRateLimiter(60 * 1000, 30);
// 邀请码校验更严格：每 IP 每分钟 10 次（防枚举）
const verifyCodeLimiter = createRateLimiter(60 * 1000, 10);

// ========== 照片校验（修复 S2：服务端校验照片数量和大小）==========
const MAX_PHOTOS_TOTAL = 15;       // 总照片数上限
const MAX_PHOTO_SIZE_BYTES = 1.5 * 1024 * 1024; // 单张 base64 约 1.5MB（压缩后 1920px 通常 < 500KB）

function validatePhotos(photos) {
  if (!photos) return null; // 无照片不校验（喷房照片必填由前端保证，服务端不强制）
  if (!Array.isArray(photos)) return '照片数据格式错误';
  if (photos.length > MAX_PHOTOS_TOTAL) return `最多上传 ${MAX_PHOTOS_TOTAL} 张照片`;

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (!p || typeof p !== 'object') return `第 ${i + 1} 张照片格式错误`;
    if (!p.data || typeof p.data !== 'string') return `第 ${i + 1} 张照片数据缺失`;
    // 校验 base64 图片前缀
    if (!p.data.startsWith('data:image/')) return `第 ${i + 1} 张照片不是有效的图片格式`;
    // 校验大小（base64 字符串长度 ≈ 原始大小 * 4/3）
    if (p.data.length > MAX_PHOTO_SIZE_BYTES * 1.37) {
      return `第 ${i + 1} 张照片过大，请压缩后重新上传`;
    }
    // 校验分类
    if (!['booth', 'air', 'power'].includes(p.category)) {
      return `第 ${i + 1} 张照片分类错误`;
    }
  }
  return null;
}

// ========== 登录速率限制（防爆破）==========
const loginFailures = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 10;

function recordFailure(ip) {
  const now = Date.now();
  const existing = loginFailures.get(ip);
  if (existing && now - existing.firstTime < RATE_WINDOW_MS) {
    existing.count++;
  } else {
    loginFailures.set(ip, { count: 1, firstTime: now });
  }
}

function cleanupExpiredFailures() {
  const now = Date.now();
  for (const [ip, record] of loginFailures) {
    if (now - record.firstTime >= RATE_WINDOW_MS) loginFailures.delete(ip);
  }
}
setInterval(cleanupExpiredFailures, 60 * 1000);

// ========== 认证中间件（Basic Auth + 速率限制）==========
function authMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  const failure = loginFailures.get(ip);
  if (failure && failure.count >= RATE_MAX_FAILURES && now - failure.firstTime < RATE_WINDOW_MS) {
    const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - failure.firstTime)) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: '登录尝试次数过多，请 ' + retryAfter + ' 秒后再试' });
  }

  const adminUser = process.env.ADMIN_USERNAME || 'CR001';
  const adminPass = process.env.ADMIN_PASSWORD;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    recordFailure(ip);
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: '需要认证' });
  }

  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const separatorIndex = decoded.indexOf(':');
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (username === adminUser && password === adminPass) {
    loginFailures.delete(ip);
    next();
  } else {
    recordFailure(ip);
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).json({ error: '用户名或密码错误' });
  }
}

// ========== 邮件通知 ==========
async function sendNotification(record) {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATION_EMAIL) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const customerName = escapeHtml(record.customer_name || '-');
    const inviteCode = escapeHtml(record.invite_code || '-');
    const surveyName = escapeHtml(record.survey_name || '-');
    const location = escapeHtml(record.location || '-');
    const vehicleTypes = escapeHtml(record.main_vehicle_types || '-');
    const interiorLength = escapeHtml(record.interior_length || '-');
    const interiorWidth = escapeHtml(record.interior_width || '-');
    const interiorHeight = escapeHtml(record.interior_height || '-');
    const submittedAt = new Date(record.created_at).toLocaleString('zh-CN');

    await resend.emails.send({
      from: '喷房勘测系统 <onboarding@resend.dev>',
      to: process.env.NOTIFICATION_EMAIL,
      subject: `新喷房勘测记录 - ${record.customer_name || record.survey_name || '未命名'}`,
      html: `
        <h2>新的喷房勘测记录</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>客户名称</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${customerName}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>邀请码</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${inviteCode}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>勘测名称</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${surveyName}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>现场地址</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${location}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>主要车型</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${vehicleTypes}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>内部尺寸</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${interiorLength} × ${interiorWidth} × ${interiorHeight}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>提交时间</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${submittedAt}</td></tr>
        </table>
      `
    });
  } catch (err) {
    console.error('邮件发送失败:', err.message);
  }
}

// ========== 公开接口（全部加限流，修复 S1）==========

// 校验邀请码
app.get('/api/verify-code', verifyCodeLimiter, async (req, res) => {
  try {
    const code = req.query.code;
    const invite = await verifyInviteCode(code);
    if (invite) {
      const survey = await getSurveyByCode(code);
      res.json({
        valid: true,
        customer_name: invite.customer_name,
        code: invite.code,
        language: invite.language || 'bi',
        survey: survey || null
      });
    } else {
      res.json({ valid: false });
    }
  } catch (err) {
    serverError(res, err, '校验邀请码失败');
  }
});

// 提交勘测记录
app.post('/api/submit', publicApiLimiter, async (req, res) => {
  try {
    const invite = await verifyInviteCode(req.body.invite_code);
    if (!invite) {
      return res.status(403).json({ error: '邀请码无效或已失效，请使用有效的专属链接提交' });
    }
    if (!req.body.survey_name && !req.body.location) {
      return res.status(400).json({ error: '勘测名称或现场地址至少填一项' });
    }
    // 照片校验（修复 S2）
    const photoError = validatePhotos(req.body.photos);
    if (photoError) {
      return res.status(400).json({ error: photoError });
    }
    const data = { ...req.body, customer_name: invite.customer_name };
    const { record, isFirstSubmission } = await submitSurvey(data);
    if (isFirstSubmission) {
      sendNotification(record);
    }
    res.json({ success: true, message: '提交成功', id: record.id });
  } catch (err) {
    serverError(res, err, '提交勘测记录失败');
  }
});

// 临时保存（草稿）
app.post('/api/save-draft', publicApiLimiter, async (req, res) => {
  try {
    const invite = await verifyInviteCode(req.body.invite_code);
    if (!invite) {
      return res.status(403).json({ error: '邀请码无效或已失效' });
    }
    const photoError = validatePhotos(req.body.photos);
    if (photoError) {
      return res.status(400).json({ error: photoError });
    }
    const data = { ...req.body, customer_name: invite.customer_name };
    const record = await saveDraft(data);
    res.json({ success: true, saved_at: record.updated_at || record.created_at, id: record.id });
  } catch (err) {
    serverError(res, err, '保存草稿失败');
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ========== 管理后台接口 ==========

// 获取记录列表（支持搜索，修复 U13；返回本月统计，修复 B3）
app.get('/api/records', authMiddleware, async (req, res) => {
  try {
    // 参数校验（修复 B8）
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;
    if (limit > 200) limit = 200; // 上限保护
    const search = req.query.search || '';
    const data = await getSurveys(page, limit, search);
    res.json(data);
  } catch (err) {
    serverError(res, err, '获取记录列表失败');
  }
});

// 获取记录详情
app.get('/api/records/:id', authMiddleware, async (req, res) => {
  try {
    const record = await getSurveyById(req.params.id);
    if (record) {
      res.json(record);
    } else {
      res.status(404).json({ error: '记录不存在' });
    }
  } catch (err) {
    serverError(res, err, '获取记录详情失败');
  }
});

// 编辑记录（修复 U14：管理员可修正客户填错的数据）
app.put('/api/records/:id', authMiddleware, async (req, res) => {
  try {
    const photoError = validatePhotos(req.body.photos);
    if (photoError) {
      return res.status(400).json({ error: photoError });
    }
    const updated = await updateSurveyById(req.params.id, req.body);
    if (updated) {
      res.json({ success: true, record: updated });
    } else {
      res.status(404).json({ error: '记录不存在' });
    }
  } catch (err) {
    serverError(res, err, '更新记录失败');
  }
});

// 删除单条记录
app.delete('/api/records/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await deleteSurvey(req.params.id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '记录不存在' });
    }
  } catch (err) {
    serverError(res, err, '删除记录失败');
  }
});

// 批量删除（修复 U15）
app.post('/api/records/batch-delete', authMiddleware, async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要删除的记录' });
    }
    if (ids.length > 100) {
      return res.status(400).json({ error: '单次最多删除 100 条' });
    }
    const count = await deleteSurveys(ids);
    res.json({ success: true, deleted: count });
  } catch (err) {
    serverError(res, err, '批量删除失败');
  }
});

// ========== 邀请码管理接口 ==========
app.get('/api/invite-codes', authMiddleware, async (req, res) => {
  try {
    const codes = await getInviteCodes();
    res.json(codes);
  } catch (err) {
    serverError(res, err, '获取邀请码列表失败');
  }
});

app.post('/api/invite-codes', authMiddleware, async (req, res) => {
  try {
    const { customer_name, description, language } = req.body;
    if (!customer_name || !String(customer_name).trim()) {
      return res.status(400).json({ error: '客户名称必填' });
    }
    if (String(customer_name).length > 200) {
      return res.status(400).json({ error: '客户名称过长（最多200字符）' });
    }
    if (language && !['zh', 'en', 'bi'].includes(language)) {
      return res.status(400).json({ error: '语言参数无效（可选：zh / en / bi）' });
    }
    const code = await createInviteCode(String(customer_name).trim(), description, language);
    res.json(code);
  } catch (err) {
    serverError(res, err, '创建邀请码失败');
  }
});

app.delete('/api/invite-codes/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await deleteInviteCode(req.params.id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '邀请码不存在' });
    }
  } catch (err) {
    serverError(res, err, '删除邀请码失败');
  }
});

app.post('/api/invite-codes/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const code = await toggleInviteCode(req.params.id);
    if (code) {
      res.json(code);
    } else {
      res.status(404).json({ error: '邀请码不存在' });
    }
  } catch (err) {
    serverError(res, err, '切换邀请码状态失败');
  }
});

// Excel 导出列定义
const EXPORT_COLUMNS = [
  { header: 'ID', key: 'id', width: 8 },
  { header: '状态', key: 'status', width: 10 },
  { header: '客户名称', key: 'customer_name', width: 18 },
  { header: '邀请码', key: 'invite_code', width: 12 },
  { header: '勘测名称', key: 'survey_name', width: 20 },
  { header: '现场地址', key: 'location', width: 35 },
  { header: '主要喷涂车型', key: 'main_vehicle_types', width: 20 },
  { header: '加热方式', key: 'heating_method', width: 15 },
  { header: '最高气压', key: 'max_air_pressure', width: 12 },
  { header: '最高温度', key: 'max_temperature', width: 12 },
  { header: '楼板厚度', key: 'floor_thickness', width: 12 },
  { header: '喷房楼层', key: 'booth_level', width: 12 },
  { header: '电梯尺寸', key: 'elevator_dimensions', width: 15 },
  { header: '地下管线情况', key: 'underground_utilities', width: 20 },
  { header: '电柜安装宽度', key: 'cabinet_install_width', width: 14 },
  { header: '小门位置', key: 'aux_door_position', width: 15 },
  { header: '门到前墙距离', key: 'door_to_front_wall', width: 14 },
  { header: '门宽', key: 'door_width', width: 10 },
  { header: '烤灯下沿高度', key: 'lamp_lower_height', width: 14 },
  { header: '烤灯上沿高度', key: 'lamp_upper_height', width: 14 },
  { header: '烤灯宽度', key: 'lamp_width', width: 12 },
  { header: '前墙到烤灯距离', key: 'front_wall_to_lamp', width: 15 },
  { header: '烤灯间距1', key: 'lamp_to_lamp_1', width: 12 },
  { header: '烤灯间距2', key: 'lamp_to_lamp_2', width: 12 },
  { header: '气源位置', key: 'air_supply_location', width: 20 },
  { header: '220V电源位置', key: 'power_supply_location', width: 20 },
  { header: '内部高度', key: 'interior_height', width: 12 },
  { header: '灯具到格栅高度', key: 'light_to_grate_height', width: 15 },
  { header: '灯具宽度', key: 'light_width', width: 12 },
  { header: '内部宽度', key: 'interior_width', width: 12 },
  { header: '内部长度', key: 'interior_length', width: 12 },
  { header: '地坑深度1', key: 'pit_depth_1', width: 12 },
  { header: '地坑深度2', key: 'pit_depth_2', width: 12 },
  { header: '地坑深度3', key: 'pit_depth_3', width: 12 },
  { header: '地坑深度4', key: 'pit_depth_4', width: 12 },
  { header: '地坑深度5', key: 'pit_depth_5', width: 12 },
  { header: '地坑深度6', key: 'pit_depth_6', width: 12 },
  { header: '地坑宽度', key: 'pit_width', width: 12 },
  { header: '墙边筋宽度', key: 'edge_bar_width', width: 12 },
  { header: '水泥墩长度', key: 'concrete_pier_length', width: 12 },
  { header: '水泥墩高度', key: 'concrete_pier_height', width: 12 },
  { header: '斜坡长度', key: 'ramp_length', width: 12 },
  { header: '斜坡高度', key: 'ramp_height', width: 12 },
  { header: '备注', key: 'remarks', width: 25 },
  { header: '提交时间', key: 'created_at', width: 20 },
  { header: '最后更新', key: 'updated_at', width: 20 }
];

// Excel 导出（使用分批查询，修复 B10：避免全量加载导致 OOM）
app.get('/api/export', authMiddleware, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('喷房勘测记录');
    worksheet.columns = EXPORT_COLUMNS;
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 分批写入，避免内存溢出
    for await (const batch of getAllSurveysBatch(100)) {
      batch.forEach(r => {
        worksheet.addRow({
          ...r,
          created_at: r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '',
          updated_at: r.updated_at ? new Date(r.updated_at).toLocaleString('zh-CN') : ''
        });
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=booth_surveys_${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    serverError(res, err, '导出 Excel 失败');
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`喷房勘测系统运行在端口 ${PORT}`);
  console.log(`表单页面: http://localhost:${PORT}/?code=你的邀请码`);
  console.log(`管理后台: http://localhost:${PORT}/admin`);
  console.log(`安全加固已启用：强制管理员密码 / 登录速率限制 / 公开接口限流 / CORS 禁用 / CSP / 安全响应头 / 错误信息脱敏 / 照片校验`);
});

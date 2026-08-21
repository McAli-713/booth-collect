const express = require('express');
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const {
  initDB, insertSurvey, saveDraft, submitSurvey, getSurveys, getSurveyById,
  getSurveyByCode, getAllSurveys, deleteSurvey,
  createInviteCode, getInviteCodes, verifyInviteCode, deleteInviteCode, toggleInviteCode
} = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 信任代理（Render 等平台通过 X-Forwarded-For 传递真实客户端 IP）
app.set('trust proxy', 1);

// ========== 安全响应头 ==========
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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

initDB();

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

// 统一服务器错误响应（不向客户端泄露内部错误细节）
function serverError(res, err, context) {
  console.error(context + ':', err);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
}

// ========== 登录速率限制（防爆破） ==========
const loginFailures = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 分钟窗口
const RATE_MAX_FAILURES = 10;            // 最多 10 次失败

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
    if (now - record.firstTime >= RATE_WINDOW_MS) {
      loginFailures.delete(ip);
    }
  }
}
setInterval(cleanupExpiredFailures, 60 * 1000); // 每分钟清理一次

// ========== 认证中间件（Basic Auth + 速率限制） ==========
function authMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  // 检查是否被限流
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
    // 认证成功，清除该 IP 的失败记录
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
    // 所有插入 HTML 的变量都经过转义，防止邮件 HTML 注入
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

// ========== 公开接口 ==========
// 校验邀请码
app.get('/api/verify-code', async (req, res) => {
  try {
    const code = req.query.code;
    const invite = await verifyInviteCode(code);
    if (invite) {
      const survey = await getSurveyByCode(code);
      res.json({
        valid: true,
        customer_name: invite.customer_name,
        code: invite.code,
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
app.post('/api/submit', async (req, res) => {
  try {
    const invite = await verifyInviteCode(req.body.invite_code);
    if (!invite) {
      return res.status(403).json({ error: '邀请码无效或已失效，请使用有效的专属链接提交' });
    }
    if (!req.body.survey_name && !req.body.location) {
      return res.status(400).json({ error: '勘测名称或现场地址至少填一项' });
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
app.post('/api/save-draft', async (req, res) => {
  try {
    const invite = await verifyInviteCode(req.body.invite_code);
    if (!invite) {
      return res.status(403).json({ error: '邀请码无效或已失效' });
    }
    const data = { ...req.body, customer_name: invite.customer_name };
    const record = await saveDraft(data);
    res.json({ success: true, saved_at: record.created_at, id: record.id });
  } catch (err) {
    serverError(res, err, '保存草稿失败');
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ========== 管理后台接口 ==========
app.get('/api/records', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const data = await getSurveys(page, limit);
    res.json(data);
  } catch (err) {
    serverError(res, err, '获取记录列表失败');
  }
});

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
    const { customer_name, description } = req.body;
    if (!customer_name) {
      return res.status(400).json({ error: '客户名称必填' });
    }
    const code = await createInviteCode(customer_name, description);
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
    res.json(code);
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
  { header: '提交时间', key: 'created_at', width: 20 }
];

app.get('/api/export', authMiddleware, async (req, res) => {
  try {
    const records = await getAllSurveys();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('喷房勘测记录');
    worksheet.columns = EXPORT_COLUMNS;
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    records.forEach(r => {
      worksheet.addRow({
        ...r,
        created_at: new Date(r.created_at).toLocaleString('zh-CN')
      });
    });
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
  console.log(`安全加固已启用：强制管理员密码 / 登录速率限制 / CORS 禁用 / 安全响应头 / 错误信息脱敏`);
});

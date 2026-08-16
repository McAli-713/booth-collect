const express = require('express');
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const { initDB, insertRecord, getRecords, getAllRecords, deleteRecord } = require('./db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 初始化数据库
initDB();

// 简单的 Basic Auth 中间件（管理后台用）
function authMiddleware(req, res, next) {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: '需要认证' });
  }
  
  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [username, password] = decoded.split(':');
  
  if (username === adminUser && password === adminPass) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).json({ error: '认证失败' });
  }
}

// 发送邮件通知
async function sendNotification(record) {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATION_EMAIL) {
    return;
  }
  
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: '喷房数据系统 <onboarding@resend.dev>',
      to: process.env.NOTIFICATION_EMAIL,
      subject: `新喷房记录 - ${record.booth_number} - ${record.operator_name}`,
      html: `
        <h2>新的喷房作业记录</h2>
        <table style="border-collapse: collapse; width: 100%;">
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>喷房编号</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${record.booth_number}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>操作员</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${record.operator_name}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>产品名称</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${record.product_name || '-'}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>涂料类型</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${record.coating_type || '-'}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>颜色编码</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${record.color_code || '-'}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>质量结果</strong></td><td style="border: 1px solid #ddd; padding: 8px; color: ${record.quality_result === '合格' ? 'green' : 'red'};">${record.quality_result || '-'}</td></tr>
          <tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>提交时间</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${new Date(record.created_at).toLocaleString('zh-CN')}</td></tr>
        </table>
      `
    });
  } catch (err) {
    console.error('邮件发送失败:', err.message);
  }
}

// ========== 公开接口 ==========

// 提交喷房记录
app.post('/api/submit', async (req, res) => {
  try {
    const { booth_number, operator_name } = req.body;
    if (!booth_number || !operator_name) {
      return res.status(400).json({ error: '喷房编号和操作员为必填项' });
    }
    
    const record = await insertRecord(req.body);
    
    // 异步发送邮件，不阻塞响应
    sendNotification(record);
    
    res.json({ success: true, message: '提交成功', id: record.id });
  } catch (err) {
    console.error('提交失败:', err);
    res.status(500).json({ error: '提交失败: ' + err.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ========== 管理后台接口（需要认证） ==========

// 获取记录列表
app.get('/api/records', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const data = await getRecords(page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除记录
app.delete('/api/records/:id', authMiddleware, async (req, res) => {
  try {
    const deleted = await deleteRecord(req.params.id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '记录不存在' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 导出 Excel
app.get('/api/export', authMiddleware, async (req, res) => {
  try {
    const records = await getAllRecords();
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('喷房记录');
    
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: '喷房编号', key: 'booth_number', width: 12 },
      { header: '操作员', key: 'operator_name', width: 12 },
      { header: '产品名称', key: 'product_name', width: 20 },
      { header: '涂料类型', key: 'coating_type', width: 15 },
      { header: '颜色编码', key: 'color_code', width: 12 },
      { header: '电压(kV)', key: 'voltage', width: 10 },
      { header: '电流(μA)', key: 'current', width: 10 },
      { header: '流量(cc/min)', key: 'flow_rate', width: 12 },
      { header: '雾化压力(bar)', key: 'spray_pressure', width: 14 },
      { header: '膜厚(μm)', key: 'thickness', width: 12 },
      { header: '质量结果', key: 'quality_result', width: 10 },
      { header: '缺陷描述', key: 'defect_description', width: 25 },
      { header: '备注', key: 'remarks', width: 25 },
      { header: '提交时间', key: 'created_at', width: 20 }
    ];
    
    // 表头样式
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
    res.setHeader('Content-Disposition', `attachment; filename=spray_records_${Date.now()}.xlsx`);
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ error: '导出失败: ' + err.message });
  }
});

// 管理后台页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`喷房数据采集系统运行在端口 ${PORT}`);
  console.log(`表单页面: http://localhost:${PORT}/`);
  console.log(`管理后台: http://localhost:${PORT}/admin`);
});

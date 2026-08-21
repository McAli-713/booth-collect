const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();
// Neon 数据库连接
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 15000
});
// 初始化数据库表
async function initDB() {
  try {
    // 邀请码表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        customer_name VARCHAR(200) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        usage_count INTEGER DEFAULT 0,
        used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 勘测记录表（增加 invite_code 字段）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booth_surveys (
        id SERIAL PRIMARY KEY,
        invite_code VARCHAR(20),
        customer_name VARCHAR(200),
        survey_name VARCHAR(200),
        location TEXT,
        main_vehicle_types VARCHAR(200),
        heating_method VARCHAR(100),
        max_air_pressure VARCHAR(50),
        max_temperature VARCHAR(50),
        floor_thickness VARCHAR(50),
        booth_level VARCHAR(50),
        elevator_dimensions VARCHAR(100),
        underground_utilities VARCHAR(200),
        cabinet_install_width VARCHAR(50),
        aux_door_position VARCHAR(100),
        door_to_front_wall VARCHAR(50),
        door_width VARCHAR(50),
        lamp_lower_height VARCHAR(50),
        lamp_upper_height VARCHAR(50),
        lamp_width VARCHAR(50),
        front_wall_to_lamp VARCHAR(50),
        lamp_to_lamp_1 VARCHAR(50),
        lamp_to_lamp_2 VARCHAR(50),
        air_supply_location VARCHAR(200),
        power_supply_location VARCHAR(200),
        interior_height VARCHAR(50),
        light_to_grate_height VARCHAR(50),
        light_width VARCHAR(50),
        interior_width VARCHAR(50),
        interior_length VARCHAR(50),
        pit_depth_1 VARCHAR(50),
        pit_depth_2 VARCHAR(50),
        pit_depth_3 VARCHAR(50),
        pit_depth_4 VARCHAR(50),
        pit_depth_5 VARCHAR(50),
        pit_depth_6 VARCHAR(50),
        pit_width VARCHAR(50),
        edge_bar_width VARCHAR(50),
        concrete_pier_length VARCHAR(50),
        concrete_pier_height VARCHAR(50),
        ramp_length VARCHAR(50),
        ramp_height VARCHAR(50),
        remarks TEXT,
        photos TEXT,
        has_elevator VARCHAR(10),
        has_lamp VARCHAR(10),
        has_pier VARCHAR(10),
        has_ramp VARCHAR(10),
        status VARCHAR(20) DEFAULT 'submitted',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 兼容旧表：如果没有 invite_code 列则添加
    try {
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20)');
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200)');
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS photos TEXT');
      await pool.query('ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS used BOOLEAN DEFAULT FALSE');
      await pool.query('ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMP');
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_elevator VARCHAR(10)');
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_lamp VARCHAR(10)');
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_pier VARCHAR(10)');
      await pool.query('ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_ramp VARCHAR(10)');
      await pool.query("ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'submitted'");
    } catch (e) { /* 已存在则忽略 */ }
    console.log('数据库表初始化完成');
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
  }
}
const FIELDS = [
  'invite_code', 'customer_name',
  'survey_name', 'location', 'main_vehicle_types', 'heating_method',
  'max_air_pressure', 'max_temperature', 'floor_thickness', 'booth_level',
  'elevator_dimensions', 'underground_utilities',
  'cabinet_install_width', 'aux_door_position', 'door_to_front_wall', 'door_width',
  'lamp_lower_height', 'lamp_upper_height', 'lamp_width',
  'front_wall_to_lamp', 'lamp_to_lamp_1', 'lamp_to_lamp_2',
  'air_supply_location', 'power_supply_location',
  'interior_height', 'light_to_grate_height', 'light_width',
  'interior_width', 'interior_length',
  'pit_depth_1', 'pit_depth_2', 'pit_depth_3', 'pit_depth_4', 'pit_depth_5', 'pit_depth_6',
  'pit_width', 'edge_bar_width',
  'concrete_pier_length', 'concrete_pier_height',
  'ramp_length', 'ramp_height',
  'remarks', 'photos',
  'has_elevator', 'has_lamp', 'has_pier', 'has_ramp'
];

// ========== 勘测记录相关 ==========
// 核心 UPSERT：按 invite_code 插入或更新
async function upsertSurvey(data, status) {
  const values = FIELDS.map(f => {
    if (f === 'photos' && Array.isArray(data[f])) {
      return JSON.stringify(data[f]);
    }
    return data[f] || null;
  });
  const existing = await pool.query(
    'SELECT id FROM booth_surveys WHERE invite_code = $1 ORDER BY id DESC LIMIT 1',
    [data.invite_code]
  );
  if (existing.rows.length > 0) {
    const setClauses = FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const updateValues = [...values, status, existing.rows[0].id];
    await pool.query(
      `UPDATE booth_surveys SET ${setClauses}, status = $${FIELDS.length + 1}, created_at = CURRENT_TIMESTAMP WHERE id = $${FIELDS.length + 2}`,
      updateValues
    );
    const result = await pool.query('SELECT * FROM booth_surveys WHERE id = $1', [existing.rows[0].id]);
    return result.rows[0];
  } else {
    const insertFields = [...FIELDS, 'status'];
    const insertPlaceholders = insertFields.map((_, i) => `$${i + 1}`).join(', ');
    const insertValues = [...values, status];
    const result = await pool.query(
      `INSERT INTO booth_surveys (${insertFields.join(', ')}) VALUES (${insertPlaceholders}) RETURNING *`,
      insertValues
    );
    return result.rows[0];
  }
}

// 临时保存（草稿）
async function saveDraft(data) {
  const record = await upsertSurvey(data, 'draft');
  if (data.invite_code) {
    await pool.query(
      'UPDATE invite_codes SET usage_count = usage_count + 1 WHERE code = $1',
      [data.invite_code]
    );
  }
  return record;
}

// 最终提交
async function submitSurvey(data) {
  const existing = await pool.query(
    "SELECT id FROM booth_surveys WHERE invite_code = $1 AND status = 'submitted' ORDER BY id DESC LIMIT 1",
    [data.invite_code]
  );
  const isFirstSubmission = existing.rows.length === 0;
  const record = await upsertSurvey(data, 'submitted');
  if (data.invite_code) {
    await pool.query(
      'UPDATE invite_codes SET usage_count = usage_count + 1, used = TRUE, used_at = CURRENT_TIMESTAMP, is_active = FALSE WHERE code = $1',
      [data.invite_code]
    );
  }
  return { record, isFirstSubmission };
}

// 兼容旧接口
async function insertSurvey(data) {
  const { record } = await submitSurvey(data);
  return record;
}

async function getSurveys(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT id, survey_name, location, main_vehicle_types, booth_level,
            invite_code, customer_name, status, created_at
     FROM booth_surveys ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query('SELECT COUNT(*) FROM booth_surveys');
  return {
    records: result.rows,
    total: parseInt(countResult.rows[0].count),
    page, limit
  };
}

async function getSurveyById(id) {
  const result = await pool.query('SELECT * FROM booth_surveys WHERE id = $1', [id]);
  const row = result.rows[0];
  if (row && row.photos) {
    try { row.photos = JSON.parse(row.photos); } catch (e) { row.photos = []; }
  }
  return row;
}

// 按邀请码获取最近一条记录（表单回填用）
async function getSurveyByCode(code) {
  if (!code) return null;
  const result = await pool.query(
    'SELECT * FROM booth_surveys WHERE invite_code = $1 ORDER BY id DESC LIMIT 1',
    [code.toUpperCase()]
  );
  const row = result.rows[0];
  if (row && row.photos) {
    try { row.photos = JSON.parse(row.photos); } catch (e) { row.photos = []; }
  }
  return row || null;
}

async function getAllSurveys() {
  const result = await pool.query('SELECT * FROM booth_surveys ORDER BY created_at DESC');
  return result.rows.map(r => {
    if (r.photos) {
      try { r.photos = JSON.parse(r.photos); } catch (e) { r.photos = []; }
    }
    return r;
  });
}

async function deleteSurvey(id) {
  const result = await pool.query('DELETE FROM booth_surveys WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

// ========== 邀请码相关 ==========
// 生成唯一邀请码（8位大写字母+数字）
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}
// 创建邀请码
async function createInviteCode(customerName, description) {
  let code;
  // 确保唯一
  for (let i = 0; i < 10; i++) {
    code = generateCode();
    const existing = await pool.query('SELECT id FROM invite_codes WHERE code = $1', [code]);
    if (existing.rows.length === 0) break;
  }
  const result = await pool.query(
    'INSERT INTO invite_codes (code, customer_name, description) VALUES ($1, $2, $3) RETURNING *',
    [code, customerName, description || null]
  );
  return result.rows[0];
}
// 获取所有邀请码
async function getInviteCodes() {
  const result = await pool.query(
    'SELECT * FROM invite_codes ORDER BY created_at DESC'
  );
  return result.rows;
}
// 校验邀请码
async function verifyInviteCode(code) {
  if (!code) return null;
  const result = await pool.query(
    'SELECT * FROM invite_codes WHERE code = $1 AND is_active = TRUE AND used = FALSE',
    [code.toUpperCase()]
  );
  return result.rows[0] || null;
}
// 删除邀请码
async function deleteInviteCode(id) {
  const result = await pool.query('DELETE FROM invite_codes WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}
// 切换邀请码启用状态（启用时同时重置 used 标记，使已提交链接可重新编辑）
async function toggleInviteCode(id) {
  const result = await pool.query(
    `UPDATE invite_codes
     SET is_active = NOT is_active,
         used = CASE WHEN is_active = FALSE THEN FALSE ELSE used END,
         used_at = CASE WHEN is_active = FALSE THEN NULL ELSE used_at END
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

module.exports = {
  pool, initDB, insertSurvey, saveDraft, submitSurvey, upsertSurvey,
  getSurveys, getSurveyById, getSurveyByCode,
  getAllSurveys, deleteSurvey, FIELDS,
  createInviteCode, getInviteCodes, verifyInviteCode, deleteInviteCode, toggleInviteCode
};

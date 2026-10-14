const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

// Neon 数据库连接（显式配置连接池，适配 Supabase 免费版连接数限制）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 5,
  allowExitOnIdle: false
});

// 连接池错误监听：连接意外断开时记录日志，pg 会自动重建
pool.on('error', (err) => {
  console.error('[DB Pool] 意外断开:', err.message);
});

// 初始化数据库表
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 邀请码表
    await client.query(`
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

    // 勘测记录表
    await client.query(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 兼容旧表：添加缺失列
    const alterStatements = [
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20)',
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200)',
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS photos TEXT',
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_elevator VARCHAR(10)',
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_lamp VARCHAR(10)',
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_pier VARCHAR(10)',
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS has_ramp VARCHAR(10)',
      "ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'submitted'",
      'ALTER TABLE booth_surveys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      'ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS used BOOLEAN DEFAULT FALSE',
      'ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMP',
      "ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'bi'"
    ];
    for (const sql of alterStatements) {
      await client.query(sql);
    }

    // 清理 invite_code 重复数据：保留每个邀请码最新的一条，删除旧的
    // （仅在存在重复时执行，避免无意义操作）
    const dupCheck = await client.query(`
      SELECT invite_code, COUNT(*) as cnt
      FROM booth_surveys
      WHERE invite_code IS NOT NULL
      GROUP BY invite_code
      HAVING COUNT(*) > 1
    `);
    if (dupCheck.rows.length > 0) {
      console.log(`[DB] 发现 ${dupCheck.rows.length} 个邀请码存在重复记录，正在清理...`);
      await client.query(`
        DELETE FROM booth_surveys
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY invite_code ORDER BY id DESC) as rn
            FROM booth_surveys
            WHERE invite_code IS NOT NULL
          ) t WHERE rn > 1
        )
      `);
      console.log('[DB] 重复记录清理完成');
    }

    // 创建 invite_code 唯一索引（兜底防重复）
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_booth_surveys_invite_code_unique
      ON booth_surveys (invite_code)
      WHERE invite_code IS NOT NULL
    `);

    // 常用查询索引
    await client.query(`CREATE INDEX IF NOT EXISTS idx_booth_surveys_created_at ON booth_surveys (created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_booth_surveys_status ON booth_surveys (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes (code)`);

    await client.query('COMMIT');
    console.log('数据库表初始化完成');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('数据库初始化失败:', err.message);
    throw err;
  } finally {
    client.release();
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

// 统一邀请码为大写（修复 B1：大小写不一致导致回填失败）
function normalizeCode(code) {
  return code ? String(code).trim().toUpperCase() : code;
}

// 解析 photos 字段
function parsePhotos(row) {
  if (row && row.photos) {
    try { row.photos = JSON.parse(row.photos); } catch (e) { row.photos = []; }
  }
  return row;
}

// ========== 勘测记录相关 ==========

/**
 * 核心 UPSERT：基于 invite_code 唯一索引的原子操作（修复 B2）
 * 使用 INSERT ... ON CONFLICT 保证并发安全
 * created_at 保持不变，只更新 updated_at（修复 B4）
 */
async function upsertSurvey(data, status) {
  const code = normalizeCode(data.invite_code);
  const values = FIELDS.map(f => {
    if (f === 'invite_code') return code;
    if (f === 'photos' && Array.isArray(data[f])) {
      return JSON.stringify(data[f]);
    }
    return data[f] != null ? data[f] : null;
  });

  // ON CONFLICT (invite_code) DO UPDATE：原子 UPSERT
  // created_at 用 COALESCE 保留原值，updated_at 刷新
  const setClauses = FIELDS.map((f, i) => `${f} = EXCLUDED.${f}`).join(', ');
  const insertFields = [...FIELDS, 'status'];
  const placeholders = insertFields.map((_, i) => `$${i + 1}`).join(', ');
  const insertValues = [...values, status];

  const result = await pool.query(
    `INSERT INTO booth_surveys (${insertFields.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (invite_code) WHERE invite_code IS NOT NULL DO UPDATE SET
       ${setClauses},
       status = EXCLUDED.status,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    insertValues
  );
  return parsePhotos(result.rows[0]);
}

// 临时保存（草稿）—— 不再递增 usage_count（修复 B5）
async function saveDraft(data) {
  const record = await upsertSurvey(data, 'draft');
  return record;
}

// 最终提交
async function submitSurvey(data) {
  const code = normalizeCode(data.invite_code);

  // 判断是否首次提交（已有 status='submitted' 的记录则不是首次）
  const existing = await pool.query(
    "SELECT id FROM booth_surveys WHERE invite_code = $1 AND status = 'submitted' LIMIT 1",
    [code]
  );
  const isFirstSubmission = existing.rows.length === 0;

  const record = await upsertSurvey(data, 'submitted');

  // 首次提交时才递增 usage_count 并标记已使用（修复 B5）
  if (isFirstSubmission && code) {
    await pool.query(
      'UPDATE invite_codes SET usage_count = usage_count + 1, used = TRUE, used_at = CURRENT_TIMESTAMP, is_active = FALSE WHERE code = $1',
      [code]
    );
  }

  return { record, isFirstSubmission };
}

// 兼容旧接口
async function insertSurvey(data) {
  const { record } = await submitSurvey(data);
  return record;
}

// 管理员编辑记录（不改变 invite_code / created_at / status）
async function updateSurveyById(id, data) {
  const editableFields = FIELDS.filter(f => f !== 'invite_code');
  const values = [];
  const setClauses = [];
  let idx = 1;
  for (const f of editableFields) {
    if (data[f] !== undefined) {
      if (f === 'photos' && Array.isArray(data[f])) {
        values.push(JSON.stringify(data[f]));
      } else {
        values.push(data[f]);
      }
      setClauses.push(`${f} = $${idx}`);
      idx++;
    }
  }
  if (setClauses.length === 0) return getSurveyById(id);
  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = await pool.query(
    `UPDATE booth_surveys SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ? parsePhotos(result.rows[0]) : null;
}

async function getSurveys(page = 1, limit = 50, search = '') {
  const offset = (page - 1) * limit;
  let whereClause = '';
  const queryParams = [limit, offset];

  if (search && search.trim()) {
    whereClause = `WHERE customer_name ILIKE $3 OR survey_name ILIKE $3 OR location ILIKE $3 OR invite_code ILIKE $3`;
    queryParams.push(`%${search.trim()}%`);
  }

  const result = await pool.query(
    `SELECT id, survey_name, location, main_vehicle_types, booth_level,
            invite_code, customer_name, status, created_at
     FROM booth_surveys ${whereClause}
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    queryParams
  );

  const countParams = search ? [`%${search.trim()}%`] : [];
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM booth_surveys ${whereClause ? whereClause.replace(/\$3/g, '$1') : ''}`,
    countParams
  );

  // 本月新增（全量统计，修复 B3）
  const monthResult = await pool.query(
    `SELECT COUNT(*) FROM booth_surveys
     WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
       AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)`
  );

  return {
    records: result.rows,
    total: parseInt(countResult.rows[0].count),
    total_this_month: parseInt(monthResult.rows[0].count),
    page, limit
  };
}

async function getSurveyById(id) {
  const result = await pool.query('SELECT * FROM booth_surveys WHERE id = $1', [id]);
  return parsePhotos(result.rows[0]);
}

// 按邀请码获取最近一条记录（表单回填用）
async function getSurveyByCode(code) {
  if (!code) return null;
  const result = await pool.query(
    'SELECT * FROM booth_surveys WHERE invite_code = $1 ORDER BY id DESC LIMIT 1',
    [normalizeCode(code)]
  );
  return result.rows[0] ? parsePhotos(result.rows[0]) : null;
}

// 分批获取所有记录（用于 Excel 导出，避免全量加载内存，修复 B10）
async function* getAllSurveysBatch(batchSize = 100) {
  let offset = 0;
  while (true) {
    const result = await pool.query(
      'SELECT * FROM booth_surveys ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [batchSize, offset]
    );
    if (result.rows.length === 0) break;
    yield result.rows.map(r => parsePhotos({ ...r }));
    offset += batchSize;
  }
}

// 保留原接口（小数据量时兼容）
async function getAllSurveys() {
  const all = [];
  for await (const batch of getAllSurveysBatch()) {
    all.push(...batch);
  }
  return all;
}

async function deleteSurvey(id) {
  const result = await pool.query('DELETE FROM booth_surveys WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

// 批量删除
async function deleteSurveys(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `DELETE FROM booth_surveys WHERE id IN (${placeholders}) RETURNING id`,
    ids
  );
  return result.rowCount;
}

// ========== 邀请码相关 ==========

// 生成唯一邀请码（8位大写字母+数字，排除易混淆字符）
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

// 创建邀请码（language: 'zh' 中文 | 'en' 英文 | 'bi' 中英双语，默认双语）
async function createInviteCode(customerName, description, language) {
  const lang = ['zh', 'en', 'bi'].includes(language) ? language : 'bi';
  let code = null;
  // 确保唯一，最多重试 10 次（修复 S8：重试耗尽后抛错而非静默插入重复）
  for (let i = 0; i < 10; i++) {
    const candidate = generateCode();
    const existing = await pool.query('SELECT id FROM invite_codes WHERE code = $1', [candidate]);
    if (existing.rows.length === 0) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    throw new Error('邀请码生成失败：重试 10 次仍冲突，请稍后重试');
  }
  const result = await pool.query(
    'INSERT INTO invite_codes (code, customer_name, description, language) VALUES ($1, $2, $3, $4) RETURNING *',
    [code, customerName, description || null, lang]
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
    [normalizeCode(code)]
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
  pool, initDB, insertSurvey, saveDraft, submitSurvey, upsertSurvey, updateSurveyById,
  getSurveys, getSurveyById, getSurveyByCode,
  getAllSurveys, getAllSurveysBatch, deleteSurvey, deleteSurveys, FIELDS,
  createInviteCode, getInviteCodes, verifyInviteCode, deleteInviteCode, toggleInviteCode,
  normalizeCode
};

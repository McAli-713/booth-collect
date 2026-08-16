const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 初始化数据库表
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spray_records (
        id SERIAL PRIMARY KEY,
        booth_number VARCHAR(50) NOT NULL,
        operator_name VARCHAR(100) NOT NULL,
        product_name VARCHAR(200),
        coating_type VARCHAR(100),
        color_code VARCHAR(50),
        voltage VARCHAR(20),
        current VARCHAR(20),
        flow_rate VARCHAR(20),
        spray_pressure VARCHAR(20),
        thickness VARCHAR(50),
        quality_result VARCHAR(20),
        defect_description TEXT,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('数据库表初始化完成');
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
  }
}

// 插入记录
async function insertRecord(data) {
  const result = await pool.query(
    `INSERT INTO spray_records 
     (booth_number, operator_name, product_name, coating_type, color_code, 
      voltage, current, flow_rate, spray_pressure, thickness, 
      quality_result, defect_description, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.booth_number, data.operator_name, data.product_name,
      data.coating_type, data.color_code, data.voltage, data.current,
      data.flow_rate, data.spray_pressure, data.thickness,
      data.quality_result, data.defect_description, data.remarks
    ]
  );
  return result.rows[0];
}

// 获取所有记录（分页）
async function getRecords(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT * FROM spray_records ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query('SELECT COUNT(*) FROM spray_records');
  return {
    records: result.rows,
    total: parseInt(countResult.rows[0].count),
    page,
    limit
  };
}

// 获取所有记录（导出用，不分页）
async function getAllRecords() {
  const result = await pool.query(
    `SELECT * FROM spray_records ORDER BY created_at DESC`
  );
  return result.rows;
}

// 删除记录
async function deleteRecord(id) {
  const result = await pool.query('DELETE FROM spray_records WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

module.exports = { pool, initDB, insertRecord, getRecords, getAllRecords, deleteRecord };

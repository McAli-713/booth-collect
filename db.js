const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 初始化数据库表 - 现场喷房勘测
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booth_surveys (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('数据库表初始化完成');
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
  }
}

const FIELDS = [
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
  'remarks'
];

async function insertSurvey(data) {
  const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(', ');
  const values = FIELDS.map(f => data[f] || null);
  const result = await pool.query(
    `INSERT INTO booth_surveys (${FIELDS.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return result.rows[0];
}

async function getSurveys(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT id, survey_name, location, main_vehicle_types, booth_level, created_at 
     FROM booth_surveys ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query('SELECT COUNT(*) FROM booth_surveys');
  return {
    records: result.rows,
    total: parseInt(countResult.rows[0].count),
    page,
    limit
  };
}

async function getSurveyById(id) {
  const result = await pool.query('SELECT * FROM booth_surveys WHERE id = $1', [id]);
  return result.rows[0];
}

async function getAllSurveys() {
  const result = await pool.query('SELECT * FROM booth_surveys ORDER BY created_at DESC');
  return result.rows;
}

async function deleteSurvey(id) {
  const result = await pool.query('DELETE FROM booth_surveys WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

module.exports = { 
  pool, initDB, insertSurvey, getSurveys, getSurveyById, 
  getAllSurveys, deleteSurvey, FIELDS
};

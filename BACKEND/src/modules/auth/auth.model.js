const pool = require('../../config/db');

async function findUserById(userId) {
  const sql = `
    SELECT 
      u.user_id,
      u.unit_type,
      u.user_type,
      u.password,
      u.user_name,
      u.zone,
      u.otp,
      u.otp_created_at,
      u.email,
      u.contact_no,
      d.divcode AS division_code,
      dept.department_id,
      dept.department
    FROM user_master u
    LEFT JOIN div_master d ON u.div_id = d.div_id
    LEFT JOIN sde.department_table dept ON u.department_id = dept.department_id
    WHERE u.user_id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [userId]);
  return rows[0];
}

async function getUserEmailById(userId) {
  const col = String(process.env.USER_EMAIL_COLUMN || 'email').trim();

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
    throw new Error('Invalid USER_EMAIL_COLUMN');
  }

  const sql = `
    SELECT ${col} AS email
    FROM user_master
    WHERE user_id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [userId]);
  return rows[0]?.email || null;
}

async function saveOtp(userId, otp, ttlMinutes = Number(process.env.OTP_TTL_MINUTES || 10)) {
  const sql = `
    UPDATE user_master
    SET otp = $2,
        otp_created_at = NOW(),
        otp_expires_at = NOW() + ($3 || ' minutes')::interval,
        otp_attempts = 0,
        otp_used = FALSE
    WHERE user_id = $1;
  `;
  await pool.query(sql, [userId, otp, String(ttlMinutes)]);
}

async function clearOtp(userId) {
  const sql = `
    UPDATE user_master
    SET otp = NULL,
        otp_created_at = NULL,
        otp_expires_at = NULL,
        otp_attempts = 0,
        otp_used = FALSE
    WHERE user_id = $1;
  `;
  await pool.query(sql, [userId]);
}

async function getOtpState(userId) {
  const sql = `
    SELECT otp, otp_created_at, otp_expires_at, otp_attempts, otp_used
    FROM user_master
    WHERE user_id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [userId]);
  return rows[0] || null;
}

async function incrementOtpAttempts(userId) {
  const sql = `
    UPDATE user_master
    SET otp_attempts = COALESCE(otp_attempts, 0) + 1
    WHERE user_id = $1;
  `;
  await pool.query(sql, [userId]);
}

async function markOtpUsed(userId) {
  const sql = `
    UPDATE user_master
    SET otp_used = TRUE
    WHERE user_id = $1;
  `;
  await pool.query(sql, [userId]);
}

module.exports = {
  findUserById,
  getUserEmailById,
  saveOtp,
  clearOtp,
  getOtpState,
  incrementOtpAttempts,
  markOtpUsed,
};

const pool = require("../../config/postgres");

async function getAllUsers() {
  const sql = `
    SELECT
      u.objectid,
      u.user_id,
      u.user_name,
      u.user_type,
      u.unit_type,
      u.unit_name,
      u.zone,
      u.division,
      COALESCE(dt.department, u.department_id) AS department_id,
      u.hrmsid,
      u.designation
    FROM user_master u
    LEFT JOIN (
      SELECT department_id, MIN(department) AS department
      FROM department_table
      GROUP BY department_id
    ) dt
      ON TRIM(u.department_id) = TRIM(dt.department_id)
    ORDER BY u.user_name
  `;

  const result = await pool.query(sql);
  return result.rows;
}

module.exports = {
  getAllUsers,
};

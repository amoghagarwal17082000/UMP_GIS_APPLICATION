const pool = require('../../../../config/postgres');

async function getUsersByDivision(divisionCode) {
  const sql = `
    SELECT
      u.objectid,
      u.user_name,
      u.user_type,
      u.unit_type,
      u.zone,
      u.division,
      COALESCE(dt.department, u.department_id) AS department_id,
      u.hrmsid,
      u.designation
    FROM user_master u
    JOIN div_master d
      ON u.division = d.div_name
    LEFT JOIN (
      SELECT department_id, MIN(department) AS department
      FROM department_table
      GROUP BY department_id
    ) dt
      ON TRIM(u.department_id) = TRIM(dt.department_id)
    WHERE d.divcode = $1
    ORDER BY u.user_name
  `;

  const result = await pool.query(sql, [divisionCode]);
  return result.rows;
}

/* ================================
   MAKER + CHECKER LIST FOR POPUP
================================ */

async function getMakerCheckerList(divisionCode) {
  const makersSql = `
    SELECT
      u.objectid,
      u.user_name
    FROM user_master u
    JOIN div_master d
      ON u.division = d.div_name
    WHERE d.divcode = $1
      AND u.user_type = 'Maker'
      AND u.assigned_checker IS NULL
    ORDER BY u.user_name
  `;

  const checkersSql = `
    SELECT
      u.objectid,
      u.user_name
    FROM user_master u
    JOIN div_master d
      ON u.division = d.div_name
    WHERE d.divcode = $1
      AND u.user_type = 'Checker'
    ORDER BY u.user_name
  `;

  const makers = await pool.query(makersSql, [divisionCode]);
  const checkers = await pool.query(checkersSql, [divisionCode]);

  return {
    makers: makers.rows,
    checkers: checkers.rows
  };
}

/* ================================
   ASSIGN CHECKER TO MAKER
================================ */

async function assignChecker(maker_id, checker_id) {
  const checkerSql = `
    SELECT user_name
    FROM user_master
    WHERE objectid = $1
  `;

  const checkerResult = await pool.query(checkerSql, [checker_id]);

  if (checkerResult.rows.length === 0) {
    throw new Error('Checker not found');
  }

  const checkerName = checkerResult.rows[0].user_name;

  const updateSql = `
    UPDATE user_master
    SET assigned_checker = $1
    WHERE objectid = $2
  `;

  await pool.query(updateSql, [checkerName, maker_id]);
}

async function getAssignedCheckerUsers(divisionCode) {
  const sql = `
    SELECT
      u.objectid,
      u.user_name,
      u.user_type,
      u.unit_type,
      u.zone,
      u.division,
      COALESCE(dt.department, u.department_id) AS department_id,
      u.hrmsid,
      u.designation,
      u.assigned_checker AS assigned_checker_name
    FROM user_master u
    JOIN div_master d
      ON u.division = d.div_name
    LEFT JOIN (
      SELECT department_id, MIN(department) AS department
      FROM department_table
      GROUP BY department_id
    ) dt
      ON TRIM(u.department_id) = TRIM(dt.department_id)
    WHERE d.divcode = $1
      AND LOWER(TRIM(u.user_type)) = 'maker'
      AND u.assigned_checker IS NOT NULL
      AND TRIM(u.assigned_checker) <> ''
    ORDER BY u.user_name
  `;

  const result = await pool.query(sql, [divisionCode]);
  return result.rows;
}

async function unassignChecker(makerId) {
  const sql = `
    UPDATE user_master
    SET assigned_checker = NULL
    WHERE objectid = $1
  `;

  await pool.query(sql, [makerId]);
}

module.exports = {
  getUsersByDivision,
  getMakerCheckerList,
  assignChecker,
  getAssignedCheckerUsers,
  unassignChecker
};

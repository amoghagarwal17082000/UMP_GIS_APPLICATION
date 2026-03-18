const pool = require('../../../../config/db');

async function getUsersByDivision(divisionCode) {

  const sql = `
    SELECT
      u.objectid,
      u.user_name,
      u.user_type,
      u.unit_type,
      u.zone,
      u.division,
      u.department_id,
      u.hrmsid,
      u.designation
    FROM user_master u
    JOIN div_master d
      ON u.division = d.div_name
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

  const sql = `
    UPDATE user_master
    SET assigned_checker = $1
    WHERE objectid = $2
  `;

  await pool.query(sql, [checker_id, maker_id]);

}

module.exports = {
  getUsersByDivision,
  getMakerCheckerList,
  assignChecker
};
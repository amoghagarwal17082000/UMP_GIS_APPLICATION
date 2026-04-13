const pool = require('../../../../config/postgres');

async function getUsersByDivision(divisionCode) {
  const sql = `
    SELECT
      u.objectid,
      u.user_id,
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
      u.user_id,
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

async function updateUserDetails(objectid, user_name, password) {
  const sql = `
    UPDATE user_master
    SET
      user_name = $2,
      password = $3
    WHERE objectid = $1
    RETURNING objectid, user_id, user_name, user_type, unit_type, zone, division, department_id, hrmsid, designation
  `;

  const result = await pool.query(sql, [objectid, user_name, password]);
  return result.rows[0];
}

async function getMakerLayerList(divisionCode) {
  const makersSql = `
    SELECT
      u.objectid,
      u.user_name,
      u.department_id,
      u.assigned_layers
    FROM user_master u
    JOIN div_master d
      ON u.division = d.div_name
    WHERE d.divcode = $1
      AND LOWER(TRIM(u.user_type)) = 'maker'
    ORDER BY u.user_name
  `;

  const makersResult = await pool.query(makersSql, [divisionCode]);

  return {
    makers: makersResult.rows
  };
}


async function getLayersByDepartment(departmentId) {
  const sql = `
    SELECT DISTINCT
      layer_id,
      layar_name
    FROM department_table
    WHERE TRIM(department_id) = TRIM($1)
    ORDER BY layar_name
  `;

  const result = await pool.query(sql, [departmentId]);
  return result.rows;
}

async function assignLayersToMaker(makerId, layerIds) {
  const getSql = `
    SELECT assigned_layers
    FROM user_master
    WHERE objectid = $1
    LIMIT 1
  `;

  const existingResult = await pool.query(getSql, [makerId]);
  const existingValue = existingResult.rows[0]?.assigned_layers || '';

  const existingIds = String(existingValue)
    .split(', ')
    .map(v => v.trim())
    .filter(Boolean);

  const incomingIds = (Array.isArray(layerIds) ? layerIds : [])
    .map(v => String(v).trim())
    .filter(Boolean);

  const mergedIds = [...new Set([...existingIds, ...incomingIds])];
  const finalValue = mergedIds.join(',');

  const updateSql = `
    UPDATE user_master
    SET assigned_layers = $2
    WHERE objectid = $1
  `;

  await pool.query(updateSql, [makerId, finalValue]);
}

async function getAssignedLayerUsers(divisionCode) {
  const sql = `
    SELECT
      u.objectid,
      u.user_id,
      u.user_name,
      u.user_type,
      u.unit_type,
      u.zone,
      u.division,
      COALESCE(dt.department, u.department_id) AS department_id,
      u.hrmsid,
      u.designation,
      COALESCE(
        (
          SELECT string_agg(layer_rows.layar_name, ', ' ORDER BY layer_rows.layar_name)
          FROM (
            SELECT DISTINCT dpt.layar_name
            FROM department_table dpt
            WHERE TRIM(dpt.layer_id::text) = ANY(
              ARRAY(
                SELECT TRIM(x)
                FROM unnest(string_to_array(COALESCE(u.assigned_layers, ''), ',')) AS x
              )
            )
          ) AS layer_rows
        ),
        ''
      ) AS assigned_layer_names,
      COALESCE(u.assigned_layers, '') AS assigned_layers
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
      AND u.assigned_layers IS NOT NULL
      AND TRIM(u.assigned_layers) <> ''
    ORDER BY u.user_name
  `;

  const result = await pool.query(sql, [divisionCode]);
  return result.rows;
}

async function updateAssignedLayers(makerId, layerIds) {
  const finalValue = (Array.isArray(layerIds) ? layerIds : [])
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join(", ");

  const sql = `
    UPDATE user_master
    SET assigned_layers = $2
    WHERE objectid = $1
  `;

  await pool.query(sql, [makerId, finalValue]);
}

async function clearAssignedLayers(makerId) {
  const sql = `
    UPDATE user_master
    SET assigned_layers = NULL
    WHERE objectid = $1
  `;

  await pool.query(sql, [makerId]);
}




module.exports = {
  getUsersByDivision,
  getMakerCheckerList,
  assignChecker,
  getAssignedCheckerUsers,
  unassignChecker,
  updateUserDetails,
  getMakerLayerList,
  getLayersByDepartment,
  assignLayersToMaker,
  getAssignedLayerUsers,
  updateAssignedLayers,
  clearAssignedLayers,
};

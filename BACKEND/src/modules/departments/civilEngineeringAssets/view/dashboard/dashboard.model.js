const pool = require('../../../../../config/postgres');

async function getCount(tableName, filters, type) {
  const zone = filters?.zone || '';
const division = filters?.division || '';
const allIndia = Boolean(filters?.allIndia);

  let statusCondition = '';
  const params = [];

  // if (!allIndia) {
  //   params.push(division);
  // }

  if (type === 'MAKER') {
    statusCondition = 'AND status IS NULL';
  } else if (type === 'CHECKER') {
    params.push('Sent to Checker');
    statusCondition = `AND UPPER(status) = UPPER($${params.length})`;
  } else if (type === 'APPROVER') {
    params.push('Sent to Approver');
    statusCondition = `AND UPPER(status) = UPPER($${params.length})`;
  } else if (type === 'FINALIZED') {
    params.push('Sent to Database');
    statusCondition = `AND UPPER(status) = UPPER($${params.length})`;
  }

  // const divisionCondition = allIndia ? '' : 'AND UPPER(division) = UPPER($1)';

let locationCondition = '';

if (division) {
  params.push(division);
  locationCondition = `AND UPPER(${tableName}.division) = UPPER($${params.length})`;
} else if (zone) {
  params.push(zone);
  locationCondition = `
    AND EXISTS (
      SELECT 1
      FROM div_master dm
      WHERE UPPER(dm.div_name) = UPPER(${tableName}.division)
        AND UPPER(dm.rly_name) = UPPER($${params.length})
    )
  `;
} 
// else if (!allIndia) {
//   params.push(division);
//   locationCondition = `AND UPPER(${tableName}.division) = UPPER($${params.length})`;
// }


  const sql = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE 1 = 1
    ${locationCondition}
    ${statusCondition};
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0]?.count || 0;
}

async function getZoneDivisionFilters() {
  const query = `
    SELECT DISTINCT
      rly_name,
      rlycode,
      div_name,
      divcode
    FROM div_master
    WHERE rly_name IS NOT NULL
      AND div_name IS NOT NULL
    ORDER BY rly_name, div_name
  `;

  const result = await pool.query(query);

  const zoneMap = new Map();

  result.rows.forEach((row) => {
    const zoneName = row.rly_name;
    const zoneCode = row.rlycode;

    if (!zoneMap.has(zoneName)) {
      zoneMap.set(zoneName, {
        zoneName,
        zoneCode,
        divisions: [],
      });
    }

    zoneMap.get(zoneName).divisions.push({
      divisionName: row.div_name,
      divisionCode: row.divcode,
    });
  });

  return Array.from(zoneMap.values());
}

module.exports = {
  getCount,
  getZoneDivisionFilters,
};

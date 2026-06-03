const pool = require('../../../../../config/postgres');

const zoneDivisionCache = {
  key: '',
  expiresAt: 0,
  data: [],
};

function isSafeTableName(tableName) {
  return /^[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*$/.test(String(tableName || ''));
}

async function getCount(tableName, filters = {}, type, allIndia = false) {
  let statusCondition = '';
  const params = [];
  const conditions = [];
  const division = String(filters?.division || '').trim();
  const zone = String(filters?.zone || '').trim();

  if (zone) {
    params.push(zone);
    conditions.push(`AND UPPER(TRIM(COALESCE(railway::text, ''))) = UPPER(TRIM($${params.length}::text))`);
  }

  if (division) {
    params.push(division);
    conditions.push(`AND UPPER(TRIM(COALESCE(division::text, ''))) = UPPER(TRIM($${params.length}::text))`);
  }

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

  if (!allIndia && !division) {
    throw new Error('division is required');
  }

  const sql = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE 1 = 1
    ${conditions.join('\n')}
    ${statusCondition};
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0]?.count || 0;
}

async function getZoneDivisionFilters(tableName) {
  if (!isSafeTableName(tableName)) return [];

  const cacheKey = tableName;
  const now = Date.now();
  if (zoneDivisionCache.key === cacheKey && zoneDivisionCache.expiresAt > now) {
    return zoneDivisionCache.data;
  }

  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(COALESCE(railway::text, '')), ''), 'Unassigned') AS zone,
      NULLIF(TRIM(COALESCE(division::text, '')), '') AS division
    FROM ${tableName}
    WHERE NULLIF(TRIM(COALESCE(division::text, '')), '') IS NOT NULL
    GROUP BY
      COALESCE(NULLIF(TRIM(COALESCE(railway::text, '')), ''), 'Unassigned'),
      NULLIF(TRIM(COALESCE(division::text, '')), '')
    ORDER BY
      COALESCE(NULLIF(TRIM(COALESCE(railway::text, '')), ''), 'Unassigned'),
      NULLIF(TRIM(COALESCE(division::text, '')), '');
  `;

  const { rows } = await pool.query(sql);
  const grouped = new Map();

  rows.forEach((row) => {
    const zone = String(row.zone || 'Unassigned').trim() || 'Unassigned';
    const division = String(row.division || '').trim();
    if (!division) return;

    if (!grouped.has(zone)) {
      grouped.set(zone, {
        zoneCode: zone,
        zoneName: zone,
        divisions: [],
      });
    }

    grouped.get(zone).divisions.push({
      divisionCode: division,
      divisionName: division,
    });
  });

  const data = Array.from(grouped.values());
  zoneDivisionCache.key = cacheKey;
  zoneDivisionCache.expiresAt = now + 5 * 60 * 1000;
  zoneDivisionCache.data = data;
  return data;
}

module.exports = { getCount, getZoneDivisionFilters };

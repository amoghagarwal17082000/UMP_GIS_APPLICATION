const pool = require('../../../../../config/postgres');

const zoneDivisionCache = {
  key: '',
  expiresAt: 0,
  data: [],
};

function isSafeTableName(tableName) {
  return /^[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*$/.test(String(tableName || ''));
}

function isSafeIdentifier(value) {
  return /^[a-zA-Z_][\w]*$/.test(String(value || ''));
}

function quoteIdentifier(value) {
  if (!isSafeIdentifier(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function getWorkflowStatusContext(workflowConfig) {
  const workflow = workflowConfig?.draftWorkflow;
  if (!workflow || !isSafeTableName(workflow.table)) return null;

  const mainIdColumn = workflowConfig.idColumn || 'objectid';
  const originalIdColumn = workflow.originalIdColumn || 'original_id';
  const editIdColumn = workflow.editIdColumn || 'edit_id';
  const statusColumn = workflow.statusColumn || 'status';

  if (![mainIdColumn, originalIdColumn, editIdColumn, statusColumn].every(isSafeIdentifier)) {
    return null;
  }

  const originalStatusValue = String(workflow.originalStatusValue || 'Under Editing').trim() || 'Under Editing';
  const handoffStatus = `UPPER(TRIM(${quoteLiteral(originalStatusValue)}::text))`;
  const effectiveStatus = `
    CASE
      WHEN UPPER(TRIM(COALESCE(m.status::text, ''))) = ${handoffStatus}
           AND COALESCE(d.__draft_exists, FALSE)
      THEN d.${quoteIdentifier(statusColumn)}::text
      ELSE m.status::text
    END
  `;

  return {
    table: workflow.table,
    mainIdColumn,
    originalIdColumn,
    editIdColumn,
    statusColumn,
    effectiveStatus,
  };
}

async function getCount(tableName, filters = {}, type, allIndia = false, workflowConfig = null) {
  let statusCondition = '';
  const params = [];
  const conditions = [];
  const division = String(filters?.division || '').trim();
  const zone = String(filters?.zone || '').trim();
  const workflowStatus = getWorkflowStatusContext(workflowConfig);
  let fromClause = `FROM ${tableName} m`;
  let statusExpression = 'm.status';
  let sourceAlias = 'm';

  if (workflowStatus) {
    statusExpression = 'e.status';
    sourceAlias = 'e';
    fromClause = `
      FROM (
        SELECT
          ${workflowStatus.effectiveStatus} AS status,
          COALESCE(d.division::text, m.division::text) AS division,
          COALESCE(d.railway::text, m.railway::text) AS railway
        FROM ${tableName} m
        LEFT JOIN LATERAL (
          SELECT
            TRUE AS __draft_exists,
            d.${quoteIdentifier(workflowStatus.statusColumn)},
            d.division,
            d.railway
          FROM ${workflowStatus.table} d
          WHERE d.${quoteIdentifier(workflowStatus.editIdColumn)}::text = m.${quoteIdentifier(workflowStatus.mainIdColumn)}::text
          ORDER BY d.${quoteIdentifier(workflowStatus.editIdColumn)} DESC
          LIMIT 1
        ) d ON TRUE

        UNION ALL

        SELECT
          d.${quoteIdentifier(workflowStatus.statusColumn)}::text AS status,
          d.division::text AS division,
          d.railway::text AS railway
        FROM ${workflowStatus.table} d
        LEFT JOIN ${tableName} m
          ON d.${quoteIdentifier(workflowStatus.editIdColumn)}::text = m.${quoteIdentifier(workflowStatus.mainIdColumn)}::text
        WHERE m.${quoteIdentifier(workflowStatus.mainIdColumn)} IS NULL
      ) e
    `;
  }

  if (zone) {
    params.push(zone);
    conditions.push(`AND UPPER(TRIM(COALESCE(${sourceAlias}.railway::text, ''))) = UPPER(TRIM($${params.length}::text))`);
  }

  if (division) {
    params.push(division);
    conditions.push(`AND UPPER(TRIM(COALESCE(${sourceAlias}.division::text, ''))) = UPPER(TRIM($${params.length}::text))`);
  }

  if (type === 'MAKER') {
    statusCondition = `AND (${statusExpression} IS NULL OR UPPER(TRIM(${statusExpression}::text)) = UPPER(TRIM('Asset Saved'::text)))`;
  } else if (type === 'CHECKER') {
    params.push('Sent to Checker');
    statusCondition = `AND UPPER(${statusExpression}) = UPPER($${params.length})`;
  } else if (type === 'APPROVER') {
    params.push('Sent to Approver');
    statusCondition = `AND UPPER(${statusExpression}) = UPPER($${params.length})`;
  } else if (type === 'FINALIZED') {
    params.push('Sent to Database');
    statusCondition = `AND UPPER(${statusExpression}) = UPPER($${params.length})`;
  }

  if (!allIndia && !division) {
    throw new Error('division is required');
  }

  const sql = `
    SELECT COUNT(*)::int AS count
    ${fromClause}
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

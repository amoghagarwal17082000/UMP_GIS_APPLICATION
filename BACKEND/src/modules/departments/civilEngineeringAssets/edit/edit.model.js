const pool = require('../../../../config/postgres');
const { irAssetDbPool } = require('../../../../config/postgres');
const generateGUID = require('../../../../utils/guid');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function splitQualifiedName(name) {
  const raw = String(name || '').trim();
  if (!raw) throw new Error('Table name is required');

  const parts = raw.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) return { schema: 'public', table: parts[0] };
  return { schema: parts[0], table: parts[1] };
}

async function getTableColumns(client, qualifiedName) {
  const { schema, table } = splitQualifiedName(qualifiedName);
  const sql = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
  `;

  const { rows } = await client.query(sql, [schema, table]);
  return rows.map((row) => String(row.column_name).trim());
}

async function getColumnDataType(client, qualifiedName, columnName) {
  const { schema, table } = splitQualifiedName(qualifiedName);
  const sql = `
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
      AND column_name = $3
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [schema, table, columnName]);
  return String(rows[0]?.data_type || '').trim().toLowerCase();
}

async function getNextManualId(client, qualifiedName, columnName) {
  const dataType = await getColumnDataType(client, qualifiedName, columnName);
  const numericTypes = new Set([
    'smallint',
    'integer',
    'bigint',
    'decimal',
    'numeric',
    'real',
    'double precision',
  ]);

  const valueExpr = numericTypes.has(dataType)
    ? `${columnName}::bigint`
    : `NULLIF(REGEXP_REPLACE(${columnName}::text, '[^0-9]', '', 'g'), '')::bigint`;

  const sql = `SELECT COALESCE(MAX(${valueExpr}), 0) + 1 AS next_id FROM ${qualifiedName}`;
  const { rows } = await client.query(sql);
  return Number(rows[0]?.next_id || 1);
}

const FIELD_ALIASES = {
  constituency: ['constituency', 'constituncy'],
  constituncy: ['constituncy', 'constituency'],
};

function resolveConfiguredColumn(field, tableColumns) {
  if (tableColumns.includes(field)) return field;
  const aliases = FIELD_ALIASES[field] || [];
  return aliases.find((alias) => tableColumns.includes(alias)) || null;
}

function getConfiguredFieldValue(data, configuredField, resolvedColumn) {
  const aliases = FIELD_ALIASES[configuredField] || FIELD_ALIASES[resolvedColumn] || [configuredField];
  for (const key of [resolvedColumn, configuredField, ...aliases]) {
    if (key && Object.prototype.hasOwnProperty.call(data || {}, key)) {
      return data[key];
    }
  }
  return null;
}

function getAliasedRecordValue(record, column) {
  if (Object.prototype.hasOwnProperty.call(record || {}, column)) {
    return { found: true, value: record[column] };
  }

  const aliases = FIELD_ALIASES[column] || [];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record || {}, alias)) {
      return { found: true, value: record[alias] };
    }
  }

  return { found: false, value: undefined };
}

function getGeometryReadColumn(config) {
  const column = String(config?.geometry?.readColumn || config?.geometry?.column || '').trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column) ? column : null;
}

function getMainSelectList(config) {
  const geometryColumn = getGeometryReadColumn(config);
  if (!geometryColumn) return '*';
  return `*, ST_X(${geometryColumn}) AS geom_lng, ST_Y(${geometryColumn}) AS geom_lat`;
}

function getDraftSelectList(config, draftTableColumns, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const configuredColumn = String(config?.geometry?.column || '').trim();
  const configuredReadColumn = String(config?.geometry?.readColumn || '').trim();
  const candidates = [configuredColumn, configuredReadColumn, 'shape', 'geom']
    .filter((column) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column));
  const geometryColumn = candidates.find((column) => draftTableColumns.includes(column));
  if (!geometryColumn) return `${prefix}*`;
  return `${prefix}*, ST_X(${prefix}${geometryColumn}) AS geom_lng, ST_Y(${prefix}${geometryColumn}) AS geom_lat`;
}

function getGeometryColumnExpression(config, tableColumns, alias) {
  const configuredColumn = String(config?.geometry?.column || '').trim();
  const configuredReadColumn = String(config?.geometry?.readColumn || '').trim();
  const candidates = [configuredColumn, configuredReadColumn, 'shape', 'geom']
    .filter((column) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column));
  const geometryColumn = candidates.find((column) => tableColumns.includes(column));
  return geometryColumn ? `${alias}.${geometryColumn}` : null;
}

function getDraftWithOriginalGeometrySelectList(config, draftTableColumns, mainTableColumns, draftAlias = 'd', mainAlias = 'm') {
  const draftGeometry = getGeometryColumnExpression(config, draftTableColumns, draftAlias);
  const mainGeometry = getGeometryColumnExpression(config, mainTableColumns, mainAlias);
  if (!draftGeometry && !mainGeometry) return `${draftAlias}.*`;
  if (draftGeometry && mainGeometry) {
    const geometryExpression = `
      CASE
        WHEN ${draftGeometry} IS NOT NULL
          AND (${mainGeometry} IS NULL OR NOT ST_Equals(${draftGeometry}, ${mainGeometry}))
          THEN ${draftGeometry}
        ELSE COALESCE(${mainGeometry}, ${draftGeometry})
      END
    `;
    return `${draftAlias}.*, ST_X(${geometryExpression}) AS geom_lng, ST_Y(${geometryExpression}) AS geom_lat, (${draftGeometry} IS NOT NULL AND ${mainGeometry} IS NOT NULL AND NOT ST_Equals(${draftGeometry}, ${mainGeometry})) AS draft_geometry_changed`;
  }
  const geometryExpression = draftGeometry || mainGeometry;
  return `${draftAlias}.*, ST_X(${geometryExpression}) AS geom_lng, ST_Y(${geometryExpression}) AS geom_lat, FALSE AS draft_geometry_changed`;
}

async function getByIdWithClient(client, config, id, division, lock = false) {
  const sql = `
    SELECT ${getMainSelectList(config)}
    FROM ${config.table}
    WHERE ${config.idColumn} = $1
      AND UPPER(division) = UPPER($2)
    ${lock ? 'FOR UPDATE' : ''}
  `;

  const { rows } = await client.query(sql, [id, division]);
  return rows[0];
}

async function getDraftAssignments(client, makerUserId, fallbackDivision) {
  const makerSql = `
    SELECT
      u.department_id,
      u.user_name,
      NULLIF(TRIM(u.assigned_checker), '') AS assigned_checker,
      dept.department,
      COALESCE(d.divcode, $2) AS division_code,
      NULLIF(TRIM(d.div_name), '') AS division_name,
      NULLIF(TRIM(rly.rlycode), '') AS railway_code
    FROM user_master u
    LEFT JOIN div_master d ON u.div_id = d.div_id
    LEFT JOIN div_master rly ON u.rly_id = rly.rly_id
    LEFT JOIN sde.department_table dept ON u.department_id = dept.department_id
    WHERE u.user_id = $1
    LIMIT 1
  `;

  const { rows: makerRows } = await client.query(makerSql, [makerUserId, fallbackDivision]);
  const maker = makerRows[0];

  if (!maker) {
    const err = new Error('Maker user not found');
    err.status = 404;
    throw err;
  }

  let checkerUserId = null;
  if (maker.assigned_checker) {
    const checkerSql = `
      SELECT u.user_id
      FROM user_master u
      WHERE LOWER(TRIM(u.user_type)) = 'checker'
        AND LOWER(TRIM(u.user_id)) = LOWER(TRIM($1))
      LIMIT 1
    `;
    const { rows: checkerRows } = await client.query(checkerSql, [maker.assigned_checker]);
    checkerUserId = checkerRows[0]?.user_id ? String(checkerRows[0].user_id).trim() : null;
  }

  const assignmentSql = `
    SELECT
      MAX(CASE WHEN LOWER(u.user_type) = 'approver' THEN u.user_id END) AS approver_user_id
    FROM user_master u
    LEFT JOIN div_master d ON u.div_id = d.div_id
    WHERE ($1::text IS NULL OR CAST(u.department_id AS text) = CAST($1 AS text))
      AND UPPER(COALESCE(d.divcode, '')) = UPPER($2)
  `;

  const { rows } = await client.query(assignmentSql, [maker.department_id ?? null, maker.division_code || fallbackDivision]);
  return {
    makerUserName: maker.user_name ? String(maker.user_name).trim() : makerUserId,
    makerDepartment: maker.department ? String(maker.department).trim() : null,
    makerDivisionName: maker.division_name ? String(maker.division_name).trim() : null,
    makerRailwayCode: maker.railway_code ? String(maker.railway_code).trim() : null,
    checkerUserId: checkerUserId || (maker.assigned_checker ? String(maker.assigned_checker).trim() : null),
    approverUserId: rows[0]?.approver_user_id ? String(rows[0].approver_user_id).trim() : null,
  };
}

async function getUserNameByUserId(client, userId) {
  const sql = `
    SELECT user_name
    FROM user_master
    WHERE user_id = $1
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [userId]);
  return rows[0]?.user_name ? String(rows[0].user_name).trim() : String(userId || '').trim();
}

async function getAssignedCheckerUserNameForMakerUserName(client, makerUserName) {
  const normalizedMakerUserName = String(makerUserName || '').trim();
  if (!normalizedMakerUserName) return '';

  const sql = `
    SELECT NULLIF(TRIM(assigned_checker), '') AS assigned_checker
    FROM user_master
    WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [normalizedMakerUserName]);
  const assignedChecker = rows[0]?.assigned_checker ? String(rows[0].assigned_checker).trim() : '';
  if (!assignedChecker) return '';

  const checkerSql = `
    SELECT NULLIF(TRIM(user_name), '') AS user_name
    FROM user_master
    WHERE LOWER(TRIM(COALESCE(user_type, ''))) = 'checker'
      AND (
        LOWER(TRIM(COALESCE(user_id, ''))) = LOWER(TRIM($1))
        OR LOWER(TRIM(COALESCE(user_name, ''))) = LOWER(TRIM($1))
      )
    LIMIT 1
  `;

  const { rows: checkerRows } = await client.query(checkerSql, [assignedChecker]);
  return checkerRows[0]?.user_name ? String(checkerRows[0].user_name).trim() : assignedChecker;
}

function getFinalModifiedBy(record) {
  return record?.approved_by ?? record?.modified_by ?? record?.edited_by ?? null;
}

function getFinalModifiedDate(record) {
  return record?.approved_at ?? record?.modified_date ?? record?.edited_at ?? null;
}

async function updateMainStatusByObjectId(client, config, objectId, division, status, finalRecord = null) {
  const numericId = Number(objectId);
  if (!Number.isFinite(numericId)) return null;
  const tableColumns = await getTableColumns(client, config.table);
  const setClauses = [];
  const values = [];

  if (tableColumns.includes('status')) {
    values.push(status);
    setClauses.push(`status = $${values.length}`);
  }

  if (finalRecord && tableColumns.includes('final_modified_by')) {
    values.push(getFinalModifiedBy(finalRecord));
    setClauses.push(`final_modified_by = $${values.length}`);
  }

  if (finalRecord && tableColumns.includes('final_modified_date')) {
    const finalDate = getFinalModifiedDate(finalRecord);
    if (finalDate) {
      values.push(finalDate);
      setClauses.push(`final_modified_date = $${values.length}`);
    } else {
      setClauses.push('final_modified_date = NOW()::timestamp without time zone');
    }
  }

  if (!setClauses.length) return null;

  values.push(numericId);
  values.push(division);

  const sql = `
    UPDATE ${config.table}
    SET ${setClauses.join(', ')}
    WHERE ${config.idColumn} = $${values.length - 1}
      AND UPPER(division) = UPPER($${values.length})
    RETURNING *
  `;

  const { rows } = await client.query(sql, values);
  return rows[0] || null;
}

async function updateMainWorkflowStatus(client, config, id, division, status) {
  return updateMainStatusByObjectId(client, config, id, division, status);
}

async function updateMainStatusFromDraft(client, config, workflow, draft, division, status, finalRecord = null) {
  return updateMainStatusByObjectId(client, config, draft?.[workflow.editIdColumn], division, status, finalRecord);
}

function normalizeStationDraftPayload(data, originalRow) {
  const lat = Number(data?.lat ?? data?.latitude ?? data?.ycoord ?? originalRow?.geom_lat ?? originalRow?.latitude ?? originalRow?.ycoord);
  const lng = Number(data?.lng ?? data?.lon ?? data?.longitude ?? data?.xcoord ?? originalRow?.geom_lng ?? originalRow?.longitude ?? originalRow?.xcoord);

  return {
    ...originalRow,
    ...data,
    sttntype: data?.sttntype ?? data?.stationtype ?? originalRow?.sttntype,
    constituncy: data?.constituncy ?? data?.constituency ?? originalRow?.constituncy ?? originalRow?.constituency,
    latitude: Number.isFinite(lat) ? lat : originalRow?.latitude ?? null,
    longitude: Number.isFinite(lng) ? lng : originalRow?.longitude ?? null,
    ycoord: Number.isFinite(lat) ? lat : originalRow?.ycoord ?? null,
    xcoord: Number.isFinite(lng) ? lng : originalRow?.xcoord ?? null,
  };
}

function getWorkflowOriginalIdValue(config, originalRow) {
  if (!originalRow) return null;
  return originalRow?.gis_unique_id ?? null;
}

async function getNewDraftEditId(client, config, draftTableColumns) {
  const workflow = config.draftWorkflow;
  if (!workflow?.editIdColumn || !draftTableColumns.includes(workflow.editIdColumn)) return undefined;
  return getNextManualId(client, config.table, config.idColumn);
}

function getBaseRecordFromDraft(config, draft, division, finalStatus = 'Sent to Database') {
  const lat = Number(draft?.geom_lat ?? draft?.latitude ?? draft?.ycoord ?? draft?.lat);
  const lng = Number(draft?.geom_lng ?? draft?.longitude ?? draft?.xcoord ?? draft?.lng ?? draft?.lon);

  return {
    ...draft,
    sttncode: draft?.sttncode ?? null,
    sttnname: draft?.sttnname ?? null,
    sttntype: draft?.sttntype ?? draft?.stationtype ?? null,
    distkm: draft?.distkm ?? null,
    distm: draft?.distm ?? null,
    state: draft?.state ?? null,
    district: draft?.district ?? null,
    constituncy: draft?.constituncy ?? draft?.constituency ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    xcoord: Number.isFinite(lng) ? lng : null,
    ycoord: Number.isFinite(lat) ? lat : null,
    railway: draft?.railway ?? null,
    category: draft?.category ?? null,
    division,
    status: finalStatus,
    final_modified_by: getFinalModifiedBy(draft),
    final_modified_date: getFinalModifiedDate(draft),
  };
}

function buildStationBaseUpdate(mainTableColumns, config, record, targetObjectId, division) {
  const setClauses = [];
  const values = [];

  mainTableColumns.forEach((column) => {
    if (column === config.idColumn) return;
    if (column === 'globalid') return;
    if (column === config.geometry?.column) return;
    const { found, value } = getAliasedRecordValue(record, column);
    if (!found) return;

    values.push(value);
    setClauses.push(`${column} = $${values.length}`);
  });

  if (
    config.geometry?.enabled &&
    config.geometry.column &&
    mainTableColumns.includes(config.geometry.column)
  ) {
    const x = Number(record[config.geometry.xField]);
    const y = Number(record[config.geometry.yField]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      setClauses.push(`${config.geometry.column} = ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)`);
    }
  }

  values.push(targetObjectId);
  values.push(division);

  return {
    setClauses,
    values,
    sql: `
      UPDATE ${config.table}
      SET ${setClauses.join(', ')}
      WHERE ${config.idColumn} = $${values.length - 1}
        AND UPPER(division) = UPPER($${values.length})
      RETURNING *
    `,
  };
}

function buildStationBaseInsert(mainTableColumns, config, record, objectId) {
  const insertColumns = [];
  const placeholders = [];
  const values = [];

  if (mainTableColumns.includes(config.idColumn)) {
    insertColumns.push(config.idColumn);
    values.push(objectId);
    placeholders.push(`$${values.length}`);
  }

  if (mainTableColumns.includes('globalid')) {
    insertColumns.push('globalid');
    values.push(generateGUID());
    placeholders.push(`$${values.length}`);
  }

  mainTableColumns.forEach((column) => {
    if (column === config.idColumn) return;
    if (column === 'globalid') return;
    if (column === config.geometry?.column) return;
    const { found, value } = getAliasedRecordValue(record, column);
    if (!found) return;

    insertColumns.push(column);
    values.push(value);
    placeholders.push(`$${values.length}`);
  });

  if (
    config.geometry?.enabled &&
    config.geometry.column &&
    mainTableColumns.includes(config.geometry.column)
  ) {
    const x = Number(record[config.geometry.xField]);
    const y = Number(record[config.geometry.yField]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      insertColumns.push(config.geometry.column);
      placeholders.push(`ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)`);
    }
  }

  return {
    insertColumns,
    placeholders,
    values,
    sql: `
      INSERT INTO ${config.table} (
        ${insertColumns.join(',')}
      )
      VALUES (
        ${placeholders.join(',')}
      )
      RETURNING *
    `,
  };
}

async function copyDraftGeometryToMain(client, config, workflow, draftObjectId, mainObjectId, division) {
  if (!config.geometry?.enabled || !config.geometry.column) return null;
  const mainTableColumns = await getTableColumns(client, config.table);
  const draftTableColumns = await getTableColumns(client, workflow.table);
  const geometryColumn = config.geometry.column;
  if (!mainTableColumns.includes(geometryColumn) || !draftTableColumns.includes(geometryColumn)) return null;
  if (!Number.isFinite(Number(draftObjectId)) || !Number.isFinite(Number(mainObjectId))) return null;

  const sql = `
    UPDATE ${config.table} m
    SET ${geometryColumn} = d.${geometryColumn}
    FROM ${workflow.table} d
    WHERE m.${config.idColumn} = $1
      AND d.objectid = $2
      AND UPPER(m.division) = UPPER($3)
      AND UPPER(d.division) = UPPER($3)
      AND d.${geometryColumn} IS NOT NULL
    RETURNING m.*
  `;

  const { rows } = await client.query(sql, [mainObjectId, draftObjectId, division]);
  return rows[0] || null;
}

function setWorkflowAssignmentFields(record, workflow, draftTableColumns, assignments) {
  if (workflow?.checkerColumn && draftTableColumns.includes(workflow.checkerColumn)) {
    record[workflow.checkerColumn] = assignments.checkerUserId;
  }

  if (workflow?.approverColumn && draftTableColumns.includes(workflow.approverColumn)) {
    record[workflow.approverColumn] = assignments.approverUserId;
  }
}

async function getById(config, id, division) {
  const sql = `
    SELECT ${getMainSelectList(config)}
    FROM ${config.table}
    WHERE ${config.idColumn} = $1
      AND UPPER(division) = UPPER($2)
  `;

  const { rows } = await pool.query(sql, [id, division]);
  return rows[0];
}

async function getDraftById(config, id, division) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  const draftTableColumns = await getTableColumns(pool, config.draftWorkflow.table);
  const mainTableColumns = await getTableColumns(pool, config.table);
  const idConditions = ['d.objectid = $1'];
  if (config.draftWorkflow.editIdColumn && draftTableColumns.includes(config.draftWorkflow.editIdColumn)) {
    idConditions.push(`d.${config.draftWorkflow.editIdColumn}::text = $1::text`);
  }

  const mainJoin = config.draftWorkflow.editIdColumn && draftTableColumns.includes(config.draftWorkflow.editIdColumn)
    ? `LEFT JOIN ${config.table} m ON m.${config.idColumn}::text = d.${config.draftWorkflow.editIdColumn}::text AND UPPER(m.division) = UPPER($2)`
    : '';
  const sql = `
    SELECT ${getDraftWithOriginalGeometrySelectList(config, draftTableColumns, mainTableColumns, 'd', 'm')}
    FROM ${config.draftWorkflow.table} d
    ${mainJoin}
    WHERE (${idConditions.join(' OR ')})
      AND UPPER(d.division) = UPPER($2)
    ORDER BY CASE WHEN d.objectid = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [id, division]);
  return rows[0];
}

async function updateStationDraftStatus(config, draftObjectId, division, nextStatus, actingUserId, actingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  const normalizedUserType = String(actingUserType || '').trim().toLowerCase();
  if (normalizedUserType !== 'checker' && normalizedUserType !== 'approver') {
    const err = new Error('Only checker or approver can perform this action');
    err.status = 403;
    throw err;
  }

  const normalizedStatus = String(nextStatus || '').trim();
  const checkerAllowedStatuses = new Set(['Sent to Approver', 'Sent Back to Maker', 'Sent to Approver for Deletion']);
  const approverAllowedStatuses = new Set(['Sent to Database', 'Sent Back to Maker', 'Asset Deleted']);
  const allowedStatuses = normalizedUserType === 'checker' ? checkerAllowedStatuses : approverAllowedStatuses;
  if (!allowedStatuses.has(normalizedStatus)) {
    const err = new Error('Invalid draft status transition');
    err.status = 400;
    throw err;
  }

  const workflow = config.draftWorkflow;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftTableColumns = await getTableColumns(client, workflow.table);
    const idConditions = ['objectid = $1'];
    if (workflow.editIdColumn && draftTableColumns.includes(workflow.editIdColumn)) {
      idConditions.push(`${workflow.editIdColumn}::text = $1::text`);
    }

    const draftSql = `
      SELECT *
      FROM ${workflow.table}
      WHERE (${idConditions.join(' OR ')})
        AND UPPER(division) = UPPER($2)
      ORDER BY CASE WHEN objectid = $1 THEN 0 ELSE 1 END
      LIMIT 1
      FOR UPDATE
    `;
    const { rows: draftRows } = await client.query(draftSql, [draftObjectId, division]);
    const draft = draftRows[0];

    if (!draft) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentStatus = String(draft?.[workflow.statusColumn] || '').trim().toLowerCase();
    const checkerExpectedStatuses = new Set(['sent to checker', 'sent to checker for deletion']);
    const approverExpectedStatuses = new Set(['sent to approver', 'sent to approver for deletion']);
    const expectedStatuses = normalizedUserType === 'checker' ? checkerExpectedStatuses : approverExpectedStatuses;
    if (!expectedStatuses.has(currentStatus)) {
      const err = new Error(
        normalizedUserType === 'checker'
          ? 'Only checker-pending drafts can be updated through this action'
          : 'Only approver-pending drafts can be updated through this action'
      );
      err.status = 400;
      throw err;
    }

    const actingUserName = await getUserNameByUserId(client, actingUserId);
    if (normalizedUserType === 'checker') {
      const makerUserName = String(draft?.edited_by || '').trim();
      const assignedCheckerUserName = await getAssignedCheckerUserNameForMakerUserName(client, makerUserName);
      if (
        assignedCheckerUserName &&
        assignedCheckerUserName.toLowerCase() !== String(actingUserName || '').trim().toLowerCase()
      ) {
        const err = new Error('This draft is assigned to a different checker');
        err.status = 403;
        throw err;
      }
    } else {
      const assignedUserColumn = workflow.approverColumn;
      const hasAssignedUserColumn = assignedUserColumn && draft?.[assignedUserColumn] != null;
      if (hasAssignedUserColumn) {
        const assignedUser = String(draft?.[assignedUserColumn] || '').trim();
        const normalizedAssignedUser = assignedUser.toLowerCase();
        const matchesActingUser =
          !assignedUser ||
          normalizedAssignedUser === String(actingUserId || '').trim().toLowerCase() ||
          normalizedAssignedUser === String(actingUserName || '').trim().toLowerCase();
        if (!matchesActingUser) {
          const err = new Error('This draft is assigned to a different approver');
          err.status = 403;
          throw err;
        }
      }
    }

    const setClauses = [`${workflow.statusColumn} = $1`];
    const params = [normalizedStatus];

    if (draftTableColumns.includes('modified_by')) {
      params.push(actingUserName);
      setClauses.push(`modified_by = $${params.length}`);
    }

    if (draftTableColumns.includes('modified_date')) {
      setClauses.push('modified_date = NOW()::timestamp without time zone');
    }

    if (
      normalizedUserType === 'checker' &&
      (normalizedStatus === 'Sent to Approver' || normalizedStatus === 'Sent to Approver for Deletion') &&
      draftTableColumns.includes('checked_by')
    ) {
      params.push(actingUserName);
      setClauses.push(`checked_by = $${params.length}`);
    }

    if (
      normalizedUserType === 'checker' &&
      (normalizedStatus === 'Sent to Approver' || normalizedStatus === 'Sent to Approver for Deletion') &&
      draftTableColumns.includes('checked_at')
    ) {
      setClauses.push('checked_at = NOW()::timestamp without time zone');
    }

    if (
      normalizedUserType === 'approver' &&
      (normalizedStatus === 'Sent to Database' || normalizedStatus === 'Asset Deleted') &&
      draftTableColumns.includes('approved_by')
    ) {
      params.push(actingUserName);
      setClauses.push(`approved_by = $${params.length}`);
    }

    if (
      normalizedUserType === 'approver' &&
      (normalizedStatus === 'Sent to Database' || normalizedStatus === 'Asset Deleted') &&
      draftTableColumns.includes('approved_at')
    ) {
      setClauses.push('approved_at = NOW()::timestamp without time zone');
    }

    params.push(draftObjectId);
    params.push(division);

    const updateSql = `
      UPDATE ${workflow.table}
      SET ${setClauses.join(', ')}
      WHERE objectid = $${params.length - 1}
        AND UPPER(division) = UPPER($${params.length})
      RETURNING *
    `;

    const { rows } = await client.query(updateSql, params);
    const updatedDraft = rows[0] || draft;

    let mainRecord = null;
    if (normalizedUserType === 'checker' && normalizedStatus === 'Sent to Approver for Deletion') {
      mainRecord = await updateMainStatusFromDraft(client, config, workflow, draft, division, 'Sent to Approver for Deletion');
    } else if (
      (normalizedUserType === 'checker' || normalizedUserType === 'approver') &&
      normalizedStatus === 'Sent Back to Maker'
    ) {
      mainRecord = await updateMainStatusFromDraft(client, config, workflow, draft, division, 'Sent Back to Maker');
    }

    if (normalizedUserType === 'approver' && normalizedStatus === 'Sent to Database') {
      const mainTableColumns = await getTableColumns(client, config.table);
      const baseRecord = getBaseRecordFromDraft(config, { ...draft, ...updatedDraft }, division, normalizedStatus);
      const existingMainId = Number(draft?.[workflow.editIdColumn]);

      if (Number.isFinite(existingMainId)) {
        const existingMainRow = await getByIdWithClient(client, config, existingMainId, division, true);
        if (existingMainRow) {
          const updateMain = buildStationBaseUpdate(mainTableColumns, config, baseRecord, existingMainId, division);
          const { rows: updatedMainRows } = await client.query(updateMain.sql, updateMain.values);
          mainRecord = updatedMainRows[0] || null;
        }
      }

      if (!mainRecord) {
        const nextMainId = await getNextManualId(client, config.table, config.idColumn);
        const insertMain = buildStationBaseInsert(mainTableColumns, config, baseRecord, nextMainId);
        const { rows: insertedMainRows } = await client.query(insertMain.sql, insertMain.values);
        mainRecord = insertedMainRows[0] || null;
      }

      const approvedMainId = Number(mainRecord?.[config.idColumn]);
      const draftGeometryMain = await copyDraftGeometryToMain(
        client,
        config,
        workflow,
        updatedDraft?.objectid ?? draft?.objectid,
        approvedMainId,
        division
      );
      if (draftGeometryMain) mainRecord = draftGeometryMain;
    }

    if (normalizedUserType === 'approver' && normalizedStatus === 'Asset Deleted') {
      mainRecord = await updateMainStatusFromDraft(client, config, workflow, draft, division, 'Asset Deleted', updatedDraft);
    }

    await client.query('COMMIT');
    return {
      draft: updatedDraft,
      main: mainRecord,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function requestStationDeletion(config, id, division, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  if (String(submittingUserType || '').trim().toLowerCase() !== 'maker') {
    const err = new Error('Only maker can request deletion');
    err.status = 403;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const originalRow = await getByIdWithClient(client, config, id, division, true);
    if (!originalRow) {
      await client.query('ROLLBACK');
      return null;
    }

    const workflow = config.draftWorkflow;
    const draftTableColumns = await getTableColumns(client, workflow.table);
    const assignments = await getDraftAssignments(client, makerUserId, division);

    const record = {
      ...originalRow,
      division,
      railway: draftTableColumns.includes('railway') ? (assignments.makerRailwayCode ?? originalRow.railway ?? null) : undefined,
      zone_name: draftTableColumns.includes('zone_name') ? (originalRow.railway ?? null) : undefined,
      fname: draftTableColumns.includes('fname') ? (originalRow.railway ?? null) : undefined,
      div_name: draftTableColumns.includes('div_name') ? (assignments.makerDivisionName ?? division ?? null) : undefined,
      department: draftTableColumns.includes('department') ? (assignments.makerDepartment ?? null) : undefined,
      [workflow.editIdColumn]: originalRow[config.idColumn],
      [workflow.originalIdColumn]: getWorkflowOriginalIdValue(config, originalRow),
      [workflow.statusColumn]: 'Sent to Checker for Deletion',
      modified_by: draftTableColumns.includes('modified_by') ? assignments.makerUserName : undefined,
      modified_date: draftTableColumns.includes('modified_date') ? '__NOW__' : undefined,
      objectid: draftTableColumns.includes('objectid') ? await getNextManualId(client, workflow.table, 'objectid') : undefined,
      globalid: draftTableColumns.includes('globalid') ? generateGUID() : undefined,
    };
    setWorkflowAssignmentFields(record, workflow, draftTableColumns, assignments);

    const { insertColumns, placeholders, values } = buildStationDraftInsert(draftTableColumns, config, record);
    const insertSql = `
      INSERT INTO ${workflow.table} (
        ${insertColumns.join(',')}
      )
      VALUES (
        ${placeholders.join(',')}
      )
      RETURNING *
    `;

    const { rows } = await client.query(insertSql, values);
    const original = await updateMainStatusByObjectId(client, config, id, division, 'Sent to Checker for Deletion');

    await client.query('COMMIT');
    return {
      draft: rows[0],
      original,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function requestStationDraftDeletion(config, draftObjectId, division, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  if (String(submittingUserType || '').trim().toLowerCase() !== 'maker') {
    const err = new Error('Only maker can request deletion');
    err.status = 403;
    throw err;
  }

  const workflow = config.draftWorkflow;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftSql = `
      SELECT *
      FROM ${workflow.table}
      WHERE objectid = $1
        AND UPPER(division) = UPPER($2)
      FOR UPDATE
    `;
    const { rows: draftRows } = await client.query(draftSql, [draftObjectId, division]);
    const draft = draftRows[0];
    if (!draft) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentStatus = String(draft?.[workflow.statusColumn] || '').trim().toLowerCase();
    if (currentStatus !== 'sent back to maker') {
      const err = new Error('Only sent-back drafts can be sent for deletion from maker rejected records');
      err.status = 400;
      throw err;
    }

    const draftTableColumns = await getTableColumns(client, workflow.table);
    const makerUserName = await getUserNameByUserId(client, makerUserId);
    const params = ['Sent to Checker for Deletion'];
    const setClauses = [`${workflow.statusColumn} = $1`];

    if (draftTableColumns.includes('modified_by')) {
      params.push(makerUserName);
      setClauses.push(`modified_by = $${params.length}`);
    }
    if (draftTableColumns.includes('modified_date')) {
      setClauses.push('modified_date = NOW()::timestamp without time zone');
    }

    params.push(draftObjectId);
    params.push(division);

    const updateSql = `
      UPDATE ${workflow.table}
      SET ${setClauses.join(', ')}
      WHERE objectid = $${params.length - 1}
        AND UPPER(division) = UPPER($${params.length})
      RETURNING *
    `;
    const { rows } = await client.query(updateSql, params);
    const main = await updateMainStatusFromDraft(client, config, workflow, draft, division, 'Sent to Checker for Deletion');

    await client.query('COMMIT');
    return {
      draft: rows[0],
      main,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resendStationDraft(config, draftObjectId, division, data, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  if (String(submittingUserType || '').trim().toLowerCase() !== 'maker') {
    const err = new Error('Only maker can resend draft');
    err.status = 403;
    throw err;
  }

  const workflow = config.draftWorkflow;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftSql = `
      SELECT *
      FROM ${workflow.table}
      WHERE objectid = $1
        AND UPPER(division) = UPPER($2)
      FOR UPDATE
    `;
    const { rows: draftRows } = await client.query(draftSql, [draftObjectId, division]);
    const draft = draftRows[0];
    if (!draft) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentStatus = String(draft?.[workflow.statusColumn] || '').trim().toLowerCase();
    if (currentStatus !== 'sent back to maker') {
      const err = new Error('Only sent-back drafts can be resent to checker');
      err.status = 400;
      throw err;
    }

    const draftTableColumns = await getTableColumns(client, workflow.table);
    const assignments = await getDraftAssignments(client, makerUserId, division);
    const makerUserName = await getUserNameByUserId(client, makerUserId);
    const merged = normalizeStationDraftPayload(data || {}, draft);

    const record = {
      ...draft,
      ...merged,
      division,
      railway: draftTableColumns.includes('railway')
        ? (assignments.makerRailwayCode ?? data?.railway ?? draft?.railway ?? null)
        : undefined,
      zone_name: draftTableColumns.includes('zone_name')
        ? (data?.zone_name ?? draft?.zone_name ?? null)
        : undefined,
      fname: draftTableColumns.includes('fname')
        ? (data?.fname ?? data?.zone_name ?? draft?.fname ?? draft?.zone_name ?? null)
        : undefined,
      div_name: draftTableColumns.includes('div_name')
        ? (assignments.makerDivisionName ?? data?.div_name ?? draft?.div_name ?? division ?? null)
        : undefined,
      department: draftTableColumns.includes('department')
        ? (data?.department ?? assignments.makerDepartment ?? draft?.department ?? null)
        : undefined,
      [workflow.statusColumn]: workflow.draftStatusValue,
      edited_by: draftTableColumns.includes('edited_by') ? makerUserName : undefined,
      edited_at: draftTableColumns.includes('edited_at') ? '__NOW__' : undefined,
      modified_by: draftTableColumns.includes('modified_by') ? makerUserName : undefined,
      modified_date: draftTableColumns.includes('modified_date') ? '__NOW__' : undefined,
    };
    setWorkflowAssignmentFields(record, workflow, draftTableColumns, assignments);

    const setClauses = [];
    const values = [];
    draftTableColumns.forEach((column) => {
      if (column === 'objectid' || column === 'globalid') return;
      if (column === config.geometry?.column) return;
      if (!Object.prototype.hasOwnProperty.call(record, column)) return;
      const value = record[column];
      if (value === undefined) return;
      if (value === '__NOW__') {
        setClauses.push(`${column} = NOW()::timestamp without time zone`);
        return;
      }
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    });

    const x = Number(record[config.geometry?.xField]);
    const y = Number(record[config.geometry?.yField]);
    if (config.geometry?.enabled && config.geometry.column && Number.isFinite(x) && Number.isFinite(y)) {
      setClauses.push(`${config.geometry.column} = ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)`);
    }

    values.push(draftObjectId);
    values.push(division);

    const updateSql = `
      UPDATE ${workflow.table}
      SET ${setClauses.join(', ')}
      WHERE objectid = $${values.length - 1}
        AND UPPER(division) = UPPER($${values.length})
      RETURNING *
    `;

    const { rows } = await client.query(updateSql, values);
    const original = await updateMainStatusFromDraft(
      client,
      config,
      workflow,
      draft,
      division,
      workflow.originalStatusValue
    );

    await client.query('COMMIT');
    return {
      draft: rows[0],
      original,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function create(config, data, division) {
  const insertColumns = [config.idColumn, 'globalid'];
  const placeholders = [];
  const values = [];
  const tableColumns = await getTableColumns(pool, config.table);

  const nextId = config.idStrategy === 'manual'
    ? await getNextManualId(pool, config.table, config.idColumn)
    : null;

  values.push(nextId);
  placeholders.push(`$${values.length}`);

  values.push(generateGUID());
  placeholders.push(`$${values.length}`);

  config.insertFields.forEach((field) => {
    const column = resolveConfiguredColumn(field, tableColumns);
    if (!column) return;
    insertColumns.push(column);
    values.push(getConfiguredFieldValue(data, field, column));
    placeholders.push(`$${values.length}`);
  });

  insertColumns.push('division');
  values.push(division);
  placeholders.push(`$${values.length}`);

  if (config.geometry?.enabled && config.geometry.column) {
    const x = Number(data?.[config.geometry.xField] ?? data?.xcoord ?? data?.lng ?? data?.longitude ?? null);
    const y = Number(data?.[config.geometry.yField] ?? data?.ycoord ?? data?.lat ?? data?.latitude ?? null);

    if (Number.isFinite(x) && Number.isFinite(y)) {
      insertColumns.push(config.geometry.column);
      values.push(x);
      const xIndex = values.length;
      values.push(y);
      const yIndex = values.length;
      placeholders.push(`ST_SetSRID(ST_MakePoint($${xIndex}, $${yIndex}), 4326)`);
    }
  }

  const sql = `
    INSERT INTO ${config.table} (
      ${insertColumns.join(',')}
    )
    VALUES (
      ${placeholders.join(',')}
    )
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0];
}

async function update(config, id, division, data) {
  const setClauses = [];
  const params = [];
  const tableColumns = await getTableColumns(pool, config.table);

  config.updateFields.forEach((field) => {
    const column = resolveConfiguredColumn(field, tableColumns);
    if (!column) return;
    params.push(getConfiguredFieldValue(data, field, column));
    setClauses.push(`${column} = $${params.length}`);
  });

  if (config.modifiedDateColumn) {
    setClauses.push(`${config.modifiedDateColumn} = NOW()`);
  }

  params.push(id);
  params.push(division);

  const sql = `
    UPDATE ${config.table}
    SET ${setClauses.join(',')}
    WHERE ${config.idColumn} = $${params.length - 1}
      AND UPPER(division) = UPPER($${params.length})
    RETURNING *
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0];
}

async function remove(config, id, division) {
  const sql = `
    DELETE FROM ${config.table}
    WHERE ${config.idColumn} = $1
      AND UPPER(division) = UPPER($2)
  `;

  const { rowCount } = await pool.query(sql, [id, division]);
  return rowCount;
}

async function getTable(config, page, pageSize, q, division) {
  const limit = Math.min(200, Math.max(1, Number(pageSize)));
  const offset = (Number(page) - 1) * limit;

  const params = [division];
  let where = `UPPER(division) = UPPER($1)`;

  if (q && config.searchableFields?.length) {
    params.push(`%${q}%`);

    const searchConditions = config.searchableFields
      .map((field) => `LOWER(${field}) LIKE LOWER($2)`)
      .join(' OR ');

    where += ` AND (${searchConditions})`;
  }

  const totalSql = `
    SELECT COUNT(*)::int AS total
    FROM ${config.table}
    WHERE ${where}
  `;

  const listSql = `
    SELECT ${getMainSelectList(config)}
    FROM ${config.table}
    WHERE ${where}
    ORDER BY ${config.idColumn}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const { rows: totalRows } = await pool.query(totalSql, params);
  const { rows } = await pool.query(listSql, params);

  return {
    rows,
    total: totalRows[0]?.total || 0,
  };
}

async function ensureAttachmentColumn(client, qualifiedName) {
  const columns = await getTableColumns(client, qualifiedName);
  if (columns.includes('attachment_bundle_url')) return;

  const { schema, table } = splitQualifiedName(qualifiedName);
  await client.query(
    `ALTER TABLE "${schema}"."${table}" ADD COLUMN IF NOT EXISTS attachment_bundle_url text`,
  );
}

async function updateRecordAttachmentUrl(config, id, division, attachmentUrl) {
  await ensureAttachmentColumn(pool, config.table);

  const sql = `
    UPDATE ${config.table}
    SET attachment_bundle_url = $1
    WHERE ${config.idColumn} = $2
      AND UPPER(division) = UPPER($3)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [attachmentUrl, id, division]);
  return rows[0] || null;
}

async function getDraftTable(config, page, pageSize, q, division, status, actingUserId, actingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  const limit = Math.min(200, Math.max(1, Number(pageSize)));
  const offset = (Number(page) - 1) * limit;
  const draftTableColumns = await getTableColumns(pool, config.draftWorkflow.table);
  const mainTableColumns = await getTableColumns(pool, config.table);
  const params = [division];
  let where = `UPPER(d.division) = UPPER($1)`;

  if (status) {
    params.push(status);
    where += ` AND UPPER(d.status) = UPPER($${params.length})`;
  }

  const normalizedUserType = String(actingUserType || '').trim().toLowerCase();
  const normalizedActingUserId = String(actingUserId || '').trim();
  if (normalizedActingUserId && normalizedUserType === 'checker') {
    const actingUserName = await getUserNameByUserId(pool, normalizedActingUserId);
    params.push(String(actingUserName || '').trim());
    const actingUserNameIndex = params.length;
    const makerAssignmentRule = draftTableColumns.includes('edited_by')
      ? `
        EXISTS (
          SELECT 1
          FROM user_master maker
          LEFT JOIN user_master checker
            ON LOWER(TRIM(COALESCE(checker.user_type, ''))) = 'checker'
           AND (
             LOWER(TRIM(COALESCE(checker.user_id, ''))) = LOWER(TRIM(COALESCE(maker.assigned_checker, '')))
             OR LOWER(TRIM(COALESCE(checker.user_name, ''))) = LOWER(TRIM(COALESCE(maker.assigned_checker, '')))
           )
          WHERE LOWER(TRIM(COALESCE(maker.user_name, ''))) = LOWER(TRIM(d.edited_by::text))
            AND LOWER(TRIM(COALESCE(checker.user_name, COALESCE(maker.assigned_checker, '')))) = LOWER($${actingUserNameIndex})
        )`
      : 'FALSE';
    where += ` AND (${makerAssignmentRule})`;
  } else if (normalizedActingUserId && normalizedUserType === 'approver') {
    const approverColumn = config.draftWorkflow.approverColumn;
    if (approverColumn && draftTableColumns.includes(approverColumn)) {
      const actingUserName = await getUserNameByUserId(pool, normalizedActingUserId);
      params.push(normalizedActingUserId);
      const actingUserIdIndex = params.length;
      params.push(String(actingUserName || '').trim());
      const actingUserNameIndex = params.length;
      where += ` AND (
        LOWER(COALESCE(d.${approverColumn}::text, '')) = LOWER($${actingUserIdIndex})
        OR LOWER(COALESCE(d.${approverColumn}::text, '')) = LOWER($${actingUserNameIndex})
      )`;
    }
  }

  if (q && config.searchableFields?.length) {
    params.push(`%${q}%`);
    const qIndex = params.length;
    const searchConditions = config.searchableFields
      .map((field) => `LOWER(d.${field}) LIKE LOWER($${qIndex})`)
      .join(' OR ');

    where += ` AND (${searchConditions})`;
  }

  const totalSql = `
    SELECT COUNT(*)::int AS total
    FROM ${config.draftWorkflow.table} d
    WHERE ${where}
  `;

  const mainJoin = config.draftWorkflow.editIdColumn && draftTableColumns.includes(config.draftWorkflow.editIdColumn)
    ? `LEFT JOIN ${config.table} m ON m.${config.idColumn}::text = d.${config.draftWorkflow.editIdColumn}::text AND UPPER(m.division) = UPPER($1)`
    : '';
  const listSql = `
    SELECT ${getDraftWithOriginalGeometrySelectList(config, draftTableColumns, mainTableColumns, 'd', 'm')}
    FROM ${config.draftWorkflow.table} d
    ${mainJoin}
    WHERE ${where}
    ORDER BY d.objectid
    LIMIT ${limit} OFFSET ${offset}
  `;

  const { rows: totalRows } = await pool.query(totalSql, params);
  const { rows } = await pool.query(listSql, params);

  return {
    rows,
    total: totalRows[0]?.total || 0,
  };
}

async function validateStation(config, stationCode) {
  if (!config.validation) {
    const err = new Error('Validation config not found for layer');
    err.status = 400;
    throw err;
  }

  const validationConfig = config.validation;
  const sql = `
    SELECT *
    FROM ${validationConfig.table}
    WHERE UPPER(station_code) = UPPER($1)
    ORDER BY station_valid_upto DESC, transaction_date_time DESC NULLS LAST
    LIMIT 1
  `;

  const { rows } = await irAssetDbPool.query(sql, [stationCode]);
  return rows[0];
}

function parseValidationPayload(payload) {
  if (payload == null || payload === '') return null;
  if (typeof payload !== 'string') return payload;

  const trimmed = payload.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (!nested) return null;
      try {
        return JSON.parse(nested);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return payload;
  }
}

async function requestTmsValidationViaFetch(url, basicAuth) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: basicAuth,
    },
  });

  if (!response.ok) {
    const err = new Error('Asset ID validation service is unavailable');
    err.status = 502;
    throw err;
  }

  const rawText = await response.text();
  return parseValidationPayload(rawText);
}

async function requestTmsValidationViaPowerShell(url, basicAuth) {
  const script = `
$ProgressPreference = 'SilentlyContinue'
try {
  $headers = @{ Authorization = $env:TMS_VALIDATION_AUTH }
  $response = Invoke-RestMethod -Uri $env:TMS_VALIDATION_URL -Method Get -Headers $headers
  $response | ConvertTo-Json -Depth 20 -Compress
} catch {
  Write-Error $_
  exit 1
}
`.trim();

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        TMS_VALIDATION_URL: url,
        TMS_VALIDATION_AUTH: basicAuth,
      },
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }
  );

  return parseValidationPayload(stdout);
}

async function requestTmsValidation(url, basicAuth) {
  try {
    return await requestTmsValidationViaFetch(url, basicAuth);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    try {
      return await requestTmsValidationViaPowerShell(url, basicAuth);
    } catch (fallbackError) {
      const err = new Error('Asset ID validation service is unavailable');
      err.status = 502;
      err.cause = fallbackError;
      throw err;
    }
  }
}

function getAssetValidationParam(layer) {
  const normalizedLayer = String(layer || '').trim().toLowerCase();
  const bridgeLayers = new Set([
    'bridge_minor',
    'bridge_end',
    'bridge_start',
    'road_over_bridge',
    'road_under_bridge',
    'foot_over_bridge',
    'rail_over_rail',
  ]);

  if (bridgeLayers.has(normalizedLayer)) return 'BRIDGE';
  if (normalizedLayer === 'switch_expansion_joint') return 'SEJ';
  if (normalizedLayer === 'buffer_rails') return 'BUFFERRAIL';
  if (normalizedLayer === 'curve_start' || normalizedLayer === 'curve_end') return 'CURVE';
  if (normalizedLayer === 'pointxing') return 'PXING';
  if (normalizedLayer === 'levelxing') return 'LC';
  if (normalizedLayer === 'tunnel_start' || normalizedLayer === 'tunnel_end') return 'TUNNEL';

  const err = new Error('Asset ID validation is not configured for this layer');
  err.status = 400;
  throw err;
}

function pickResultValue(result, keys) {
  if (!result || typeof result !== 'object') return undefined;

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(result, key) && result[key] != null && String(result[key]).trim() !== '') {
      return result[key];
    }
  }

  const lowered = Object.entries(result).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = value;
    return acc;
  }, {});

  for (const key of keys) {
    const value = lowered[String(key).toLowerCase()];
    if (value != null && String(value).trim() !== '') return value;
  }

  return undefined;
}

function normalizeValidatedAssetResult(result) {
  return {
    asset_id: pickResultValue(result, ['asset_id', 'assetid']),
    distkm: pickResultValue(result, ['distkm', 'dist_km', 'km']),
    distm: pickResultValue(result, ['distm', 'dist_m', 'm']),
    latitude: pickResultValue(result, ['latitude', 'lat', 'ycoord']),
    longitude: pickResultValue(result, ['longitude', 'lng', 'lon', 'xcoord']),
    xcoord: pickResultValue(result, ['xcoord', 'longitude', 'lng', 'lon']),
    ycoord: pickResultValue(result, ['ycoord', 'latitude', 'lat']),
    railway: pickResultValue(result, ['railway', 'zone_name', 'fname']),
    division: pickResultValue(result, ['division', 'div_name']),
    tmssection: pickResultValue(result, ['tmssection', 'tms_section']),
    state: pickResultValue(result, ['state']),
    district: pickResultValue(result, ['district']),
    bridgeno: pickResultValue(result, ['bridgeno', 'bridge_no', 'bridgeid']),
    constituency: pickResultValue(result, ['constituency', 'constituncy']),
    bridgetype: pickResultValue(result, ['bridgetype', 'bridge_type']),
    spanconf: pickResultValue(result, ['spanconf', 'span_configuration']),
    raw: result,
  };
}

async function validateAssetId(config, layer, division, assetId, objectId = null) {
  const trimmedAssetId = String(assetId || '').trim();
  if (!trimmedAssetId) {
    const err = new Error('asset_id is required');
    err.status = 400;
    throw err;
  }

  if (config?.table && config?.idColumn) {
    const duplicateParams = [trimmedAssetId];
    let duplicateSql = `
      SELECT ${config.idColumn}
      FROM ${config.table}
      WHERE TRIM(COALESCE(asset_id::text, '')) = TRIM($1)
    `;

    if (Number.isFinite(Number(objectId))) {
      duplicateParams.push(Number(objectId));
      duplicateSql += ` AND ${config.idColumn} <> $2`;
    }

    duplicateSql += ' LIMIT 1';

    const { rows: existingRows } = await pool.query(duplicateSql, duplicateParams);
    if (existingRows.length > 0) {
      const err = new Error('Asset ID already exists. Please enter a different Asset ID.');
      err.status = 409;
      throw err;
    }
  }

  const validationParam = getAssetValidationParam(layer);
  const username = String(process.env.TMS_GIS_USERNAME || '').trim();
  const password = String(process.env.TMS_GIS_PASSWORD || '').trim();
  const endpoint = String(process.env.TMS_GIS_DETAILS_URL || 'https://ircep.gov.in/TMSREST/GetGISDetails').trim();

  if (!username || !password) {
    const err = new Error('TMS asset validation credentials are not configured');
    err.status = 500;
    throw err;
  }

  const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const url = `${endpoint}?param=${encodeURIComponent(validationParam)}&assetid=${encodeURIComponent(trimmedAssetId)}`;

  const parsed = await requestTmsValidation(url, basicAuth);

  if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
    const err = new Error('Asset ID not validated. Please enter a valid Asset ID.');
    err.status = 404;
    throw err;
  }

  return normalizeValidatedAssetResult(Array.isArray(parsed) ? parsed[0] : parsed);
}

function buildStationDraftInsert(draftTableColumns, config, record) {
  const insertColumns = [];
  const placeholders = [];
  const values = [];

  draftTableColumns.forEach((column) => {
    if (column === config.geometry?.column) return;
    const { found, value } = getAliasedRecordValue(record, column);
    if (!found) return;
    if (value === undefined) return;
    insertColumns.push(column);
    if (value === '__NOW__') {
      placeholders.push('NOW()::timestamp without time zone');
      return;
    }
    values.push(value);
    placeholders.push(`$${values.length}`);
  });

  if (config.geometry?.enabled && draftTableColumns.includes(config.geometry.column)) {
    const x = Number(record[config.geometry.xField]);
    const y = Number(record[config.geometry.yField]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      insertColumns.push(config.geometry.column);
      placeholders.push(`ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)`);
    }
  }

  return { insertColumns, placeholders, values };
}

async function sendStationEdit(config, id, division, data, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const originalRow = await getByIdWithClient(client, config, id, division, true);
    if (!originalRow) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentStatus = originalRow?.status == null ? '' : String(originalRow.status).trim();
    if (currentStatus) {
      const err = new Error('Only maker-pending records can be sent through this workflow');
      err.status = 400;
      throw err;
    }

    const workflow = config.draftWorkflow;
    const draftTableColumns = await getTableColumns(client, workflow.table);
    const assignments = await getDraftAssignments(client, makerUserId, division);
    const merged = normalizeStationDraftPayload(data, originalRow);

    const record = {
      ...merged,
      division,
      railway: draftTableColumns.includes('railway')
        ? (assignments.makerRailwayCode ?? data?.railway ?? originalRow.railway ?? null)
        : undefined,
      zone_name: draftTableColumns.includes('zone_name') ? (data?.zone_name ?? originalRow.railway ?? null) : undefined,
      fname: draftTableColumns.includes('fname') ? (data?.fname ?? data?.zone_name ?? originalRow.railway ?? null) : undefined,
      div_name: draftTableColumns.includes('div_name') ? (assignments.makerDivisionName ?? data?.div_name ?? division ?? null) : undefined,
      department: draftTableColumns.includes('department') ? (data?.department ?? assignments.makerDepartment ?? null) : undefined,
      [workflow.editIdColumn]: originalRow[config.idColumn],
      [workflow.originalIdColumn]: getWorkflowOriginalIdValue(config, originalRow),
      [workflow.statusColumn]: workflow.draftStatusValue,
      edited_by: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('edited_by') ? assignments.makerUserName : undefined,
      edited_at: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('edited_at') ? '__NOW__' : undefined,
      modified_by: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('modified_by') ? assignments.makerUserName : undefined,
      modified_date: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('modified_date') ? '__NOW__' : undefined,
      objectid: draftTableColumns.includes('objectid') ? await getNextManualId(client, workflow.table, 'objectid') : undefined,
      globalid: draftTableColumns.includes('globalid') ? generateGUID() : undefined,
    };
    setWorkflowAssignmentFields(record, workflow, draftTableColumns, assignments);

    const { insertColumns, placeholders, values } = buildStationDraftInsert(draftTableColumns, config, record);

    const insertSql = `
      INSERT INTO ${workflow.table} (
        ${insertColumns.join(',')}
      )
      VALUES (
        ${placeholders.join(',')}
      )
      RETURNING *
    `;



    // const updateOriginalSql = `
    //   UPDATE ${config.table}
    //   SET ${workflow.statusColumn} = $1
    //   WHERE ${config.idColumn} = $2
    //     AND UPPER(division) = UPPER($3)
    //   RETURNING *
    // `;

    // const { rows: originalRows } = await client.query(updateOriginalSql, [
    //   workflow.originalStatusValue,
    //   id,
    //   division,
    // ]);


    const { rows } = await client.query(insertSql, values);

    const original = await updateMainWorkflowStatus(client, config, id, division, workflow.originalStatusValue);

    await client.query('COMMIT');
    return {
      draft: rows[0],
      original,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function sendNewStationEdit(config, division, data, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workflow = config.draftWorkflow;
    const draftTableColumns = await getTableColumns(client, workflow.table);
    const assignments = await getDraftAssignments(client, makerUserId, division);
    const merged = normalizeStationDraftPayload(data || {}, {});
    const nextDraftObjectId = draftTableColumns.includes('objectid')
      ? await getNextManualId(client, workflow.table, 'objectid')
      : undefined;
    const nextEditId = draftTableColumns.includes(workflow.editIdColumn)
      ? await getNextManualId(client, workflow.table, workflow.editIdColumn)
      : undefined;
    const isMakerSubmit = String(submittingUserType || '').toLowerCase() === 'maker';

    const record = {
      ...merged,
      division,
      railway: draftTableColumns.includes('railway')
        ? (assignments.makerRailwayCode ?? data?.railway ?? null)
        : undefined,
      zone_name: draftTableColumns.includes('zone_name') ? (data?.zone_name ?? data?.railway ?? null) : undefined,
      fname: draftTableColumns.includes('fname') ? (data?.fname ?? data?.zone_name ?? data?.railway ?? null) : undefined,
      div_name: draftTableColumns.includes('div_name') ? (assignments.makerDivisionName ?? data?.div_name ?? division ?? null) : undefined,
      department: draftTableColumns.includes('department') ? (data?.department ?? assignments.makerDepartment ?? null) : undefined,
      [workflow.editIdColumn]: nextEditId,
      [workflow.originalIdColumn]: null,
      [workflow.statusColumn]: workflow.draftStatusValue,
      edited_by: isMakerSubmit && draftTableColumns.includes('edited_by') ? assignments.makerUserName : undefined,
      edited_at: isMakerSubmit && draftTableColumns.includes('edited_at') ? '__NOW__' : undefined,
      created_by: isMakerSubmit && draftTableColumns.includes('created_by') ? assignments.makerUserName : undefined,
      created_date: isMakerSubmit && draftTableColumns.includes('created_date') ? '__NOW__' : undefined,
      objectid: nextDraftObjectId,
      globalid: draftTableColumns.includes('globalid') ? generateGUID() : undefined,
    };
    setWorkflowAssignmentFields(record, workflow, draftTableColumns, assignments);

    const { insertColumns, placeholders, values } = buildStationDraftInsert(draftTableColumns, config, record);

    const insertSql = `
      INSERT INTO ${workflow.table} (
        ${insertColumns.join(',')}
      )
      VALUES (
        ${placeholders.join(',')}
      )
      RETURNING *
    `;

    const { rows } = await client.query(insertSql, values);

    await client.query('COMMIT');
    return {
      draft: rows[0],
      original: null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
module.exports = {
  getById,
  getDraftById,
  ensureAttachmentColumn,
  updateStationDraftStatus,
  requestStationDeletion,
  requestStationDraftDeletion,
  resendStationDraft,
  create,
  update,
  remove,
  getTable,
  getDraftTable,
  updateRecordAttachmentUrl,
  validateStation,
  validateAssetId,
  sendStationEdit,
  sendNewStationEdit,
};




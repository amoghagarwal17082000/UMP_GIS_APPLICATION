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
  asset_id: ['asset_id', 'assetid'],
  assetid: ['assetid', 'asset_id'],
  constituency: ['constituency', 'constituncy'],
  constituncy: ['constituncy', 'constituency'],
  robno: ['robno', 'bridgeno', 'rorno'],
  rubno: ['rubno', 'bridgeno', 'rorno'],
  rorno: ['rorno', 'bridgeno'],
  bridgeno: ['bridgeno', 'robno', 'rubno', 'rorno'],
};

function resolveConfiguredColumn(field, tableColumns) {
  if (tableColumns.includes(field)) return field;
  const aliases = FIELD_ALIASES[field] || [];
  return aliases.find((alias) => tableColumns.includes(alias)) || null;
}

function resolveGeometryWriteColumn(config, tableColumns) {
  const candidates = [
    config?.geometry?.column,
    config?.geometry?.readColumn,
    'shape',
    'geom',
    'geometry',
    'wkb_geometry',
  ]
    .map((column) => String(column || '').trim())
    .filter(Boolean);

  return candidates.find((candidate) =>
    tableColumns.some((column) => String(column).toLowerCase() === candidate.toLowerCase()),
  ) || null;
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

function getGeometryReadColumn(config, tableColumns = null) {
  const column = String(config?.geometry?.readColumn || config?.geometry?.column || '').trim();
  const candidates = [column, config?.geometry?.column, 'shape', 'geom', 'geometry', 'wkb_geometry']
    .map((item) => String(item || '').trim())
    .filter((item) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(item));
  if (Array.isArray(tableColumns)) {
    return candidates.find((candidate) => tableColumns.includes(candidate)) || null;
  }
  return candidates[0] || null;
}

function getMainSelectList(config, tableColumns = null) {
  const geometryColumn = getGeometryReadColumn(config, tableColumns);
  if (!geometryColumn) return '*';
  return `*, ST_X(ST_PointOnSurface(${geometryColumn})) AS geom_lng, ST_Y(ST_PointOnSurface(${geometryColumn})) AS geom_lat, ST_AsGeoJSON(${geometryColumn})::json AS asset_geometry_geojson`;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function getTableSelectList(config, tableColumns = []) {
  const geometryColumn = getGeometryReadColumn(config, tableColumns);
  const selectableColumns = tableColumns
    .filter((column) => column !== geometryColumn)
    .map((column) => quoteIdentifier(column));

  return selectableColumns.length ? selectableColumns.join(', ') : '*';
}

function getMakerTableColumns(config, tableColumns = [], geometryColumn = null) {
  const preferred = [
    config.idColumn,
    'objectid',
    'status',
    'asset_id',
    'assetid',
    'sttncode',
    'sttnname',
    'bridgeno',
    'robno',
    'rubno',
    'rorno',
    'distkm',
    'distm',
    'distfromkm',
    'distfromm',
    'disttokm',
    'disttom',
    'state',
    'district',
    'constituncy',
    'constituency',
    'division',
    'asset_division',
    ...(config.searchableFields || []),
    ...(config.insertFields || []),
    ...(config.updateFields || []),
  ];

  return preferred
    .filter((column) => column && column !== geometryColumn && tableColumns.includes(column))
    .filter((column, index, list) => list.indexOf(column) === index);
}

function getDivisionColumn(tableColumns) {
  return [
    'asset_division',
    'division',
    'division_code',
    'divisioncode',
    'divcode',
    'div_code',
    'div',
    'rlydiv',
    'rly_div',
    'div_name',
  ]
    .find((column) => tableColumns.includes(column)) || null;
}

function normalizeDivisionSql(expression) {
  return `UPPER(TRIM(COALESCE(${expression}::text, '')))`;
}

function normalizeDivisionValues(...values) {
  return values
    .flat()
    .map((value) => String(value || '').trim())
    .filter((value, index, list) => value && list.indexOf(value) === index);
}

function buildDivisionWhereClause(columnName, paramIndexes) {
  if (!columnName) return 'TRUE';
  const indexes = Array.isArray(paramIndexes) ? paramIndexes : [paramIndexes];
  const conditions = indexes
    .filter((index) => Number.isFinite(Number(index)))
    .map((index) => `${normalizeDivisionSql(columnName)} = ${normalizeDivisionSql(`$${index}`)}`);
  return conditions.length ? `(${conditions.join(' OR ')})` : 'TRUE';
}

function getDraftSelectList(config, draftTableColumns, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const configuredColumn = String(config?.geometry?.column || '').trim();
  const configuredReadColumn = String(config?.geometry?.readColumn || '').trim();
  const candidates = [configuredColumn, configuredReadColumn, 'shape', 'geom', 'geometry']
    .filter((column) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column));
  const geometryColumn = candidates.find((column) => draftTableColumns.includes(column));
  if (!geometryColumn) return `${prefix}*`;
  return `${prefix}*, ST_X(${prefix}${geometryColumn}) AS geom_lng, ST_Y(${prefix}${geometryColumn}) AS geom_lat`;
}

function getGeometryColumnExpression(config, tableColumns, alias) {
  const configuredColumn = String(config?.geometry?.column || '').trim();
  const configuredReadColumn = String(config?.geometry?.readColumn || '').trim();
  const candidates = [configuredColumn, configuredReadColumn, 'shape', 'geom', 'geometry']
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

async function getByIdWithClient(client, config, id, division, lock = false, divisionAliases = []) {
  const tableColumns = await getTableColumns(client, config.table);
  const divisionColumn = getDivisionColumn(tableColumns);
  const params = [id];
  const divisions = normalizeDivisionValues(division, divisionAliases);
  const divisionParamIndexes = divisions.map((value) => params.push(value));
  const divisionWhere = divisionColumn && division
    ? buildDivisionWhereClause(divisionColumn, divisionParamIndexes)
    : 'TRUE';

  const sql = `
    SELECT ${getMainSelectList(config, tableColumns)}
    FROM ${config.table}
    WHERE ${config.idColumn} = $1
      AND ${divisionWhere}
    ${lock ? 'FOR UPDATE' : ''}
  `;

  const { rows } = await client.query(sql, params);
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

function getLayerNameFromConfig(config) {
  return splitQualifiedName(config?.table || '').table;
}

function isValidatedAssetIdLayer(config) {
  try {
    getAssetValidationParam(getLayerNameFromConfig(config));
    return true;
  } catch (_) {
    return false;
  }
}

function getAssetIdColumn(tableColumns) {
  if (tableColumns.includes('asset_id')) return 'asset_id';
  if (tableColumns.includes('assetid')) return 'assetid';
  return null;
}

function getRecordAssetId(record, columnName = 'asset_id') {
  const direct = getAliasedRecordValue(record, columnName);
  if (direct.found && direct.value != null) return String(direct.value).trim();

  const fallback = getAliasedRecordValue(record, columnName === 'assetid' ? 'asset_id' : 'assetid');
  if (fallback.found && fallback.value != null) return String(fallback.value).trim();

  return '';
}

function createDuplicateAssetIdError(assetId) {
  const err = new Error(`Asset ID ${assetId} already exists. Please enter a different Asset ID.`);
  err.status = 409;
  return err;
}

async function ensureUniqueValidatedAssetId(client, config, record, options = {}) {
  if (!isValidatedAssetIdLayer(config)) return;

  const mainTableColumns = options.mainTableColumns || await getTableColumns(client, config.table);
  const mainAssetIdColumn = getAssetIdColumn(mainTableColumns);
  const assetId = getRecordAssetId(record, mainAssetIdColumn || 'asset_id');
  if (!assetId) return;

  if (mainAssetIdColumn) {
    const values = [assetId];
    let sql = `
      SELECT ${config.idColumn}
      FROM ${config.table}
      WHERE TRIM(COALESCE(${mainAssetIdColumn}::text, '')) = TRIM($1)
    `;

    if (Number.isFinite(Number(options.excludeMainObjectId))) {
      values.push(Number(options.excludeMainObjectId));
      sql += ` AND ${config.idColumn} <> $${values.length}`;
    }

    sql += ' LIMIT 1';
    const { rows } = await client.query(sql, values);
    if (rows.length > 0) throw createDuplicateAssetIdError(assetId);
  }

  const workflow = config.draftWorkflow;
  if (!workflow?.table) return;

  const draftTableColumns = options.draftTableColumns || await getTableColumns(client, workflow.table);
  const draftAssetIdColumn = getAssetIdColumn(draftTableColumns);
  if (!draftAssetIdColumn) return;

  const values = [assetId];
  const conditions = [`TRIM(COALESCE(${draftAssetIdColumn}::text, '')) = TRIM($1)`];

  if (Number.isFinite(Number(options.excludeDraftObjectId))) {
    values.push(Number(options.excludeDraftObjectId));
    conditions.push(`objectid <> $${values.length}`);
  }

  if (workflow.statusColumn && draftTableColumns.includes(workflow.statusColumn)) {
    conditions.push(`
      LOWER(TRIM(COALESCE(${workflow.statusColumn}::text, ''))) NOT IN (
        'sent to database',
        'asset deleted',
        'sent to checker for deletion',
        'sent to approver for deletion'
      )
    `);
  }

  const sql = `
    SELECT objectid
    FROM ${workflow.table}
    WHERE ${conditions.join('\n      AND ')}
    LIMIT 1
  `;

  const { rows } = await client.query(sql, values);
  if (rows.length > 0) throw createDuplicateAssetIdError(assetId);
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

async function getById(config, id, division, divisionAliases = []) {
  const tableColumns = await getTableColumns(pool, config.table);
  const divisionColumn = getDivisionColumn(tableColumns);
  const params = [id];
  const divisions = normalizeDivisionValues(division, divisionAliases);
  const divisionParamIndexes = divisions.map((value) => params.push(value));
  const divisionWhere = divisionColumn && division
    ? buildDivisionWhereClause(divisionColumn, divisionParamIndexes)
    : 'TRUE';

  const sql = `
    SELECT ${getMainSelectList(config, tableColumns)}
    FROM ${config.table}
    WHERE ${config.idColumn} = $1
      AND ${divisionWhere}
  `;

  const { rows } = await pool.query(sql, params);
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
        await ensureUniqueValidatedAssetId(client, config, baseRecord, {
          mainTableColumns,
          draftTableColumns,
          excludeDraftObjectId: updatedDraft?.objectid ?? draft?.objectid,
        });
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

async function create(config, data, division, makerUserId = '') {
  const insertColumns = [config.idColumn, 'globalid'];
  const placeholders = [];
  const values = [];
  const tableColumns = await getTableColumns(pool, config.table);
  await ensureUniqueValidatedAssetId(pool, config, data, { mainTableColumns: tableColumns });
  const auditColumns = new Set(['created_by', 'created_at', 'created_date']);
  const hasInsertColumn = (columnName) =>
    insertColumns.some((existing) => String(existing).toLowerCase() === String(columnName).toLowerCase());

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
    if (auditColumns.has(String(column).toLowerCase())) return;
    if (insertColumns.some((existing) => String(existing).toLowerCase() === String(column).toLowerCase())) return;
    insertColumns.push(column);
    values.push(getConfiguredFieldValue(data, field, column));
    placeholders.push(`$${values.length}`);
  });

  if (!insertColumns.some((column) => String(column).toLowerCase() === 'division')) {
    insertColumns.push('division');
    values.push(division);
    placeholders.push(`$${values.length}`);
  }

  if (tableColumns.includes('created_by') && !hasInsertColumn('created_by')) {
    const creatorName = makerUserId
      ? await getUserNameByUserId(pool, makerUserId)
      : String(data?.created_by || '').trim();
    insertColumns.push('created_by');
    values.push(creatorName || null);
    placeholders.push(`$${values.length}`);
  }

  const createdTimestampColumn = ['created_at', 'created_date'].find((column) => tableColumns.includes(column));
  if (createdTimestampColumn && !hasInsertColumn(createdTimestampColumn)) {
    insertColumns.push(createdTimestampColumn);
    placeholders.push('NOW()');
  }

  const geometryWriteColumn = config.geometry?.enabled
    ? resolveGeometryWriteColumn(config, tableColumns)
    : null;

  if (geometryWriteColumn) {
    const x = Number(data?.[config.geometry.xField] ?? data?.xcoord ?? data?.lng ?? data?.longitude ?? null);
    const y = Number(data?.[config.geometry.yField] ?? data?.ycoord ?? data?.lat ?? data?.latitude ?? null);

    if (Number.isFinite(x) && Number.isFinite(y)) {
      const geometryColumnAlreadyAdded = insertColumns.some(
        (column) => String(column).toLowerCase() === String(geometryWriteColumn).toLowerCase(),
      );
      if (!geometryColumnAlreadyAdded) {
        insertColumns.push(geometryWriteColumn);
        values.push(x);
        const xIndex = values.length;
        values.push(y);
        const yIndex = values.length;
        placeholders.push(`ST_SetSRID(ST_MakePoint($${xIndex}, $${yIndex}), 4326)`);
      }
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

async function getTable(config, page, pageSize, q, division, status = '', divisionAliases = []) {
  if (String(status || '').trim().toLowerCase() === '__empty__' && config.draftWorkflow) {
    return getMakerEditTable(config, page, pageSize, q, division, divisionAliases);
  }

  const limit = Math.min(200, Math.max(1, Number(pageSize)));
  const offset = (Number(page) - 1) * limit;

  const tableColumns = await getTableColumns(pool, config.table);
  const divisionColumn = getDivisionColumn(tableColumns);
  const params = [];
  let where = 'TRUE';

  if (divisionColumn && division) {
    const divisions = normalizeDivisionValues(division, divisionAliases);
    const divisionParamIndexes = divisions.map((value) => params.push(value));
    where = buildDivisionWhereClause(divisionColumn, divisionParamIndexes);
  }

  if (status) {
    if (tableColumns.includes('status')) {
      if (String(status).trim().toLowerCase() === '__empty__') {
        where += ` AND (status IS NULL OR TRIM(COALESCE(status::text, '')) = '' OR UPPER(TRIM(status::text)) = 'ASSET SAVED')`;
      } else {
        params.push(status);
        where += ` AND UPPER(status) = UPPER($${params.length})`;
      }
    }
  }

  if (q && config.searchableFields?.length) {
    const searchConditions = config.searchableFields
      .filter((field) => tableColumns.includes(field))
      .map((field) => `LOWER(${field}::text) LIKE LOWER($${params.length + 1})`);

    if (searchConditions.length) {
      params.push(`%${q}%`);
      where += ` AND (${searchConditions.join(' OR ')})`;
    }
  }

  const orderColumn = tableColumns.includes(config.idColumn) ? config.idColumn : tableColumns[0] || '1';
  const orderSql = tableColumns.includes(config.idColumn)
    ? `${config.idColumn} DESC`
    : tableColumns.includes('created_date')
      ? `created_date DESC NULLS LAST, ${orderColumn} DESC`
      : `${orderColumn} DESC`;

  const listSql = `
    SELECT ${getTableSelectList(config, tableColumns)}
    FROM ${config.table}
    WHERE ${where}
    ORDER BY ${orderSql}
    LIMIT ${limit + 1} OFFSET ${offset}
  `;

  const { rows } = await pool.query(listSql, params);
  const pageRows = rows.slice(0, limit);
  const hasNextPage = rows.length > limit;

  return {
    rows: pageRows,
    total: hasNextPage ? offset + limit + 1 : offset + pageRows.length,
  };
}

async function getMakerEditTable(config, page, pageSize, q, division, divisionAliases = []) {
  const limit = Math.min(200, Math.max(1, Number(pageSize)));
  const offset = (Number(page) - 1) * limit;
  const fetchLimit = offset + limit + 1;
  const mainTableColumns = await getTableColumns(pool, config.table);
  const workflow = config.draftWorkflow;
  const draftTableColumns = await getTableColumns(pool, workflow.table);
  if (!draftTableColumns.length) {
    return getTable({ ...config, draftWorkflow: null }, page, pageSize, q, division, '__empty__', divisionAliases);
  }
  const divisionColumn = getDivisionColumn(mainTableColumns);
  const draftDivisionColumn = getDivisionColumn(draftTableColumns);
  const geometryColumn = getGeometryReadColumn(config, mainTableColumns);
  const selectColumns = getMakerTableColumns(config, mainTableColumns, geometryColumn);
  const params = [];
  const divisions = normalizeDivisionValues(division, divisionAliases);
  const divisionIndexes = divisions.map((value) => params.push(value));
  const mainDivisionWhere = divisionColumn
    ? buildDivisionWhereClause(`m.${quoteIdentifier(divisionColumn)}`, divisionIndexes)
    : 'TRUE';
  const draftDivisionWhere = draftDivisionColumn
    ? buildDivisionWhereClause(`d.${quoteIdentifier(draftDivisionColumn)}`, divisionIndexes)
    : 'TRUE';

  const mainSelect = selectColumns
    .map((column) => `(m.${quoteIdentifier(column)})::text AS ${quoteIdentifier(column)}`)
    .join(',\n        ');

  const draftSelect = selectColumns
    .map((column) => {
      if (column === config.idColumn && draftTableColumns.includes('objectid')) {
        return `(d.objectid)::text AS ${quoteIdentifier(column)}`;
      }
      if (draftTableColumns.includes(column)) {
        return `(d.${quoteIdentifier(column)})::text AS ${quoteIdentifier(column)}`;
      }
      if (mainTableColumns.includes(column)) {
        return `(m.${quoteIdentifier(column)})::text AS ${quoteIdentifier(column)}`;
      }
      return `NULL::text AS ${quoteIdentifier(column)}`;
    })
    .join(',\n        ');

  const draftStatusWhere = draftTableColumns.includes(workflow.statusColumn)
    ? `TRIM(COALESCE(d.${quoteIdentifier(workflow.statusColumn)}::text, '')) = ''`
    : 'TRUE';
  const mainStatusWhere = mainTableColumns.includes('status')
    ? `(m.status IS NULL OR TRIM(COALESCE(m.status::text, '')) = '')`
    : 'TRUE';
  const mainSearchConditions = [];
  const draftSearchConditions = [];
  if (q && config.searchableFields?.length) {
    params.push(`%${q}%`);
    const qIndex = params.length;
    config.searchableFields
      .filter((field) => selectColumns.includes(field))
      .forEach((field) => {
        mainSearchConditions.push(`LOWER(m.${quoteIdentifier(field)}::text) LIKE LOWER($${qIndex})`);
        if (draftTableColumns.includes(field)) {
          draftSearchConditions.push(`LOWER(d.${quoteIdentifier(field)}::text) LIKE LOWER($${qIndex})`);
        } else if (mainTableColumns.includes(field)) {
          draftSearchConditions.push(`LOWER(m.${quoteIdentifier(field)}::text) LIKE LOWER($${qIndex})`);
        }
      });
  }
  const mainSearchWhere = mainSearchConditions.length ? `AND (${mainSearchConditions.join(' OR ')})` : '';
  const draftSearchWhere = draftSearchConditions.length ? `AND (${draftSearchConditions.join(' OR ')})` : '';

  const draftMainRefColumn = [workflow.editIdColumn, workflow.originalIdColumn]
    .find((column) => column && draftTableColumns.includes(column));

  const draftJoin = draftMainRefColumn
    ? `LEFT JOIN ${config.table} m ON m.${quoteIdentifier(config.idColumn)}::text = d.${quoteIdentifier(draftMainRefColumn)}::text AND ${mainDivisionWhere}`
    : '';

  const mainSql = `
    SELECT
        ${mainSelect},
        FALSE AS "__is_draft",
        m.${quoteIdentifier(config.idColumn)} AS "__main_objectid",
        NULL::bigint AS "__draft_objectid",
        m.${quoteIdentifier(config.idColumn)} AS "__sort_objectid"
      FROM ${config.table} m
      WHERE ${mainDivisionWhere}
        AND ${mainStatusWhere}
        ${mainSearchWhere}
      ORDER BY m.${quoteIdentifier(config.idColumn)} DESC
      LIMIT ${fetchLimit}
  `;

  const editIdSortExpr = draftMainRefColumn
    ? `NULLIF(REGEXP_REPLACE(d.${quoteIdentifier(draftMainRefColumn)}::text, '[^0-9]', '', 'g'), '')::bigint`
    : 'NULL::bigint';
  const draftSql = `
    SELECT
        ${draftSelect},
        TRUE AS "__is_draft",
        ${editIdSortExpr} AS "__main_objectid",
        d.objectid AS "__draft_objectid",
        COALESCE(${editIdSortExpr}, d.objectid) AS "__sort_objectid"
      FROM ${workflow.table} d
      ${draftJoin}
      WHERE ${draftDivisionWhere}
        AND ${draftStatusWhere}
        ${draftSearchWhere}
      ORDER BY "__sort_objectid" DESC, "__is_draft" DESC
      LIMIT ${fetchLimit}
  `;

  const [{ rows: mainRows }, { rows: draftRows }] = await Promise.all([
    pool.query(mainSql, params),
    pool.query(draftSql, params),
  ]);
  const rows = [...mainRows, ...draftRows].sort((a, b) => {
    const aSort = Number(a.__sort_objectid ?? a.objectid ?? 0);
    const bSort = Number(b.__sort_objectid ?? b.objectid ?? 0);
    if (bSort !== aSort) return bSort - aSort;
    return Number(Boolean(b.__is_draft)) - Number(Boolean(a.__is_draft));
  });
  const pageRows = rows.slice(offset, offset + limit);
  const hasNextPage = rows.length > offset + limit;
  return {
    rows: pageRows,
    total: hasNextPage ? offset + limit + 1 : offset + pageRows.length,
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
    'rob',
    'rub_lhs',
    'ror',
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
    const mainTableColumns = await getTableColumns(pool, config.table);
    const assetIdColumn = getAssetIdColumn(mainTableColumns);
    if (assetIdColumn) {
      const duplicateSql = `
      SELECT ${quoteIdentifier(config.idColumn)}
      FROM ${config.table}
      WHERE TRIM(COALESCE(${quoteIdentifier(assetIdColumn)}::text, '')) = TRIM($1)
    `;
      const { rows: existingRows } = await pool.query(duplicateSql, [trimmedAssetId]);
      if (existingRows.length > 1) {
        const err = new Error('Asset ID already exists more than once in the main table. Please correct duplicate records before validating.');
        err.status = 409;
        throw err;
      }
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

function buildStationDraftUpdate(draftTableColumns, config, record, targetDraftObjectId, division) {
  const setClauses = [];
  const values = [];
  draftTableColumns.forEach((column) => {
    if (column === 'objectid' || column === 'globalid') return;
    if (column === config.geometry?.column) return;
    if (!Object.prototype.hasOwnProperty.call(record, column)) return;
    const value = record[column];
    if (value === undefined) return;
    if (value === '__NOW__') {
      setClauses.push(`${quoteIdentifier(column)} = NOW()::timestamp without time zone`);
      return;
    }
    values.push(value);
    setClauses.push(`${quoteIdentifier(column)} = $${values.length}`);
  });

  if (config.geometry?.enabled && draftTableColumns.includes(config.geometry.column)) {
    const x = Number(record[config.geometry.xField]);
    const y = Number(record[config.geometry.yField]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      setClauses.push(`${quoteIdentifier(config.geometry.column)} = ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)`);
    }
  }

  values.push(targetDraftObjectId);
  values.push(division);
  return {
    setClauses,
    values,
    sql: `
      UPDATE ${config.draftWorkflow.table}
      SET ${setClauses.join(', ')}
      WHERE objectid = $${values.length - 1}
        AND UPPER(division) = UPPER($${values.length})
      RETURNING *
    `,
  };
}

function buildMakerSavedDraftRecord(config, draftTableColumns, sourceRow, data, division, assignments, makerUserName, draftObjectId = null) {
  const workflow = config.draftWorkflow;
  const merged = normalizeStationDraftPayload(data || {}, sourceRow || {});
  const record = {
    ...merged,
    division,
    railway: draftTableColumns.includes('railway')
      ? (assignments.makerRailwayCode ?? data?.railway ?? sourceRow?.railway ?? null)
      : undefined,
    zone_name: draftTableColumns.includes('zone_name') ? (data?.zone_name ?? sourceRow?.zone_name ?? sourceRow?.railway ?? null) : undefined,
    fname: draftTableColumns.includes('fname') ? (data?.fname ?? data?.zone_name ?? sourceRow?.fname ?? sourceRow?.railway ?? null) : undefined,
    div_name: draftTableColumns.includes('div_name') ? (assignments.makerDivisionName ?? data?.div_name ?? sourceRow?.div_name ?? division ?? null) : undefined,
    department: draftTableColumns.includes('department') ? (data?.department ?? assignments.makerDepartment ?? sourceRow?.department ?? null) : undefined,
    [workflow.statusColumn]: null,
    edited_by: draftTableColumns.includes('edited_by') ? makerUserName : undefined,
    edited_at: draftTableColumns.includes('edited_at') ? '__NOW__' : undefined,
    modified_by: draftTableColumns.includes('modified_by') ? makerUserName : undefined,
    modified_date: draftTableColumns.includes('modified_date') ? '__NOW__' : undefined,
  };

  if (workflow.editIdColumn && draftTableColumns.includes(workflow.editIdColumn)) {
    record[workflow.editIdColumn] = sourceRow?.[workflow.editIdColumn] ?? sourceRow?.[config.idColumn] ?? sourceRow?.__main_objectid ?? null;
  }
  if (workflow.originalIdColumn && draftTableColumns.includes(workflow.originalIdColumn)) {
    record[workflow.originalIdColumn] = sourceRow?.[workflow.originalIdColumn] ?? getWorkflowOriginalIdValue(config, sourceRow);
  }
  if (draftObjectId != null && draftTableColumns.includes('objectid')) record.objectid = draftObjectId;
  setWorkflowAssignmentFields(record, workflow, draftTableColumns, assignments);
  return record;
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
    await ensureUniqueValidatedAssetId(client, config, record, {
      draftTableColumns,
      excludeMainObjectId: originalRow[config.idColumn],
    });

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

async function saveStationDraft(config, id, division, data, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  if (String(submittingUserType || '').trim().toLowerCase() !== 'maker') {
    const err = new Error('Only maker can save draft records');
    err.status = 403;
    throw err;
  }

  const workflow = config.draftWorkflow;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const originalRow = await getByIdWithClient(client, config, id, division, true);
    if (!originalRow) {
      await client.query('ROLLBACK');
      return null;
    }

    const draftTableColumns = await getTableColumns(client, workflow.table);
    const assignments = await getDraftAssignments(client, makerUserId, division);
    const makerUserName = await getUserNameByUserId(client, makerUserId);

    let draft = null;
    if (workflow.editIdColumn && draftTableColumns.includes(workflow.editIdColumn)) {
      const { rows: draftRows } = await client.query(
        `
          SELECT *
          FROM ${workflow.table}
          WHERE ${quoteIdentifier(workflow.editIdColumn)}::text = $1::text
            AND UPPER(division) = UPPER($2)
            AND TRIM(COALESCE(${quoteIdentifier(workflow.statusColumn)}::text, '')) = ''
          ORDER BY objectid DESC
          LIMIT 1
          FOR UPDATE
        `,
        [id, division],
      );
      draft = draftRows[0] || null;
    }

    let savedDraft = null;
    if (draft) {
      const record = buildMakerSavedDraftRecord(config, draftTableColumns, draft, data, division, assignments, makerUserName, draft.objectid);
      await ensureUniqueValidatedAssetId(client, config, record, {
        draftTableColumns,
        excludeMainObjectId: originalRow[config.idColumn],
        excludeDraftObjectId: draft.objectid,
      });
      const update = buildStationDraftUpdate(draftTableColumns, config, record, draft.objectid, division);
      const { rows } = await client.query(update.sql, update.values);
      savedDraft = rows[0] || draft;
    } else {
      const nextDraftObjectId = draftTableColumns.includes('objectid')
        ? await getNextManualId(client, workflow.table, 'objectid')
        : undefined;
      const record = {
        ...buildMakerSavedDraftRecord(config, draftTableColumns, originalRow, data, division, assignments, makerUserName, nextDraftObjectId),
        globalid: draftTableColumns.includes('globalid') ? generateGUID() : undefined,
      };
      await ensureUniqueValidatedAssetId(client, config, record, {
        draftTableColumns,
        excludeMainObjectId: originalRow[config.idColumn],
      });
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
      savedDraft = rows[0] || null;
    }

    const original = await updateMainWorkflowStatus(client, config, id, division, 'Asset Saved');
    await client.query('COMMIT');
    return {
      draft: savedDraft,
      original,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateSavedStationDraft(config, draftObjectId, division, data, makerUserId, submittingUserType) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }
  if (String(submittingUserType || '').trim().toLowerCase() !== 'maker') {
    const err = new Error('Only maker can save draft records');
    err.status = 403;
    throw err;
  }

  const workflow = config.draftWorkflow;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const draftTableColumns = await getTableColumns(client, workflow.table);
    const { rows: draftRows } = await client.query(
      `
        SELECT *
        FROM ${workflow.table}
        WHERE objectid = $1
          AND UPPER(division) = UPPER($2)
          AND TRIM(COALESCE(${quoteIdentifier(workflow.statusColumn)}::text, '')) = ''
        FOR UPDATE
      `,
      [draftObjectId, division],
    );
    const draft = draftRows[0];
    if (!draft) {
      await client.query('ROLLBACK');
      return null;
    }

    const assignments = await getDraftAssignments(client, makerUserId, division);
    const makerUserName = await getUserNameByUserId(client, makerUserId);
    const record = buildMakerSavedDraftRecord(config, draftTableColumns, draft, data, division, assignments, makerUserName, draft.objectid);
    await ensureUniqueValidatedAssetId(client, config, record, {
      draftTableColumns,
      excludeMainObjectId: draft?.[workflow.editIdColumn],
      excludeDraftObjectId: draft.objectid,
    });
    const update = buildStationDraftUpdate(draftTableColumns, config, record, draft.objectid, division);
    const { rows } = await client.query(update.sql, update.values);
    const main = await updateMainStatusFromDraft(client, config, workflow, draft, division, 'Asset Saved');
    await client.query('COMMIT');
    return {
      draft: rows[0],
      original: main,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function submitSavedStationDraft(config, draftObjectId, division, data, makerUserId, submittingUserType) {
  const saved = await updateSavedStationDraft(config, draftObjectId, division, data, makerUserId, submittingUserType);
  if (!saved?.draft) return saved;
  const workflow = config.draftWorkflow;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const draftTableColumns = await getTableColumns(client, workflow.table);
    const assignments = await getDraftAssignments(client, makerUserId, division);
    const makerUserName = await getUserNameByUserId(client, makerUserId);
    const params = [workflow.draftStatusValue];
    const setClauses = [`${quoteIdentifier(workflow.statusColumn)} = $1`];
    if (draftTableColumns.includes('edited_by')) {
      params.push(makerUserName);
      setClauses.push(`edited_by = $${params.length}`);
    }
    if (draftTableColumns.includes('edited_at')) setClauses.push('edited_at = NOW()::timestamp without time zone');
    if (draftTableColumns.includes('modified_by')) {
      params.push(makerUserName);
      setClauses.push(`modified_by = $${params.length}`);
    }
    if (draftTableColumns.includes('modified_date')) setClauses.push('modified_date = NOW()::timestamp without time zone');
    if (workflow.checkerColumn && draftTableColumns.includes(workflow.checkerColumn)) {
      params.push(assignments.checkerUserId);
      setClauses.push(`${quoteIdentifier(workflow.checkerColumn)} = $${params.length}`);
    }
    if (workflow.approverColumn && draftTableColumns.includes(workflow.approverColumn)) {
      params.push(assignments.approverUserId);
      setClauses.push(`${quoteIdentifier(workflow.approverColumn)} = $${params.length}`);
    }
    params.push(draftObjectId);
    params.push(division);
    const { rows } = await client.query(
      `
        UPDATE ${workflow.table}
        SET ${setClauses.join(', ')}
        WHERE objectid = $${params.length - 1}
          AND UPPER(division) = UPPER($${params.length})
        RETURNING *
      `,
      params,
    );
    const main = await updateMainStatusFromDraft(client, config, workflow, rows[0] || saved.draft, division, workflow.originalStatusValue);
    await client.query('COMMIT');
    return {
      draft: rows[0],
      original: main,
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
    await ensureUniqueValidatedAssetId(client, config, record, { draftTableColumns });

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
  saveStationDraft,
  updateSavedStationDraft,
  submitSavedStationDraft,
  sendStationEdit,
  sendNewStationEdit,
};




const pool = require('../../../../config/postgres');
const { irAssetDbPool } = require('../../../../config/postgres');
const generateGUID = require('../../../../utils/guid');

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

async function getByIdWithClient(client, config, id, division, lock = false) {
  const sql = `
    SELECT *
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

  const assignmentSql = `
    SELECT
      MAX(CASE WHEN LOWER(u.user_type) = 'checker' THEN u.user_id END) AS checker_user_id,
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
    checkerUserId: rows[0]?.checker_user_id ? String(rows[0].checker_user_id).trim() : null,
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

function normalizeStationDraftPayload(data, originalRow) {
  const lat = Number(data?.lat ?? data?.latitude ?? data?.ycoord ?? originalRow?.latitude ?? originalRow?.ycoord);
  const lng = Number(data?.lng ?? data?.lon ?? data?.longitude ?? data?.xcoord ?? originalRow?.longitude ?? originalRow?.xcoord);

  return {
    ...originalRow,
    ...data,
    sttntype: data?.sttntype ?? data?.stationtype ?? originalRow?.sttntype,
    constituncy: data?.constituncy ?? data?.constituency ?? originalRow?.constituncy,
    latitude: Number.isFinite(lat) ? lat : originalRow?.latitude ?? null,
    longitude: Number.isFinite(lng) ? lng : originalRow?.longitude ?? null,
    ycoord: Number.isFinite(lat) ? lat : originalRow?.ycoord ?? null,
    xcoord: Number.isFinite(lng) ? lng : originalRow?.xcoord ?? null,
  };
}

function getStationBaseRecordFromDraft(config, draft, division) {
  const lat = Number(draft?.latitude ?? draft?.ycoord ?? draft?.lat);
  const lng = Number(draft?.longitude ?? draft?.xcoord ?? draft?.lng ?? draft?.lon);

  return {
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
    status: draft?.original_id ? 'Asset Edited and Finalised' : 'Sent to Database',
  };
}

function buildStationBaseUpdate(mainTableColumns, config, record, targetObjectId, division) {
  const setClauses = [];
  const values = [];

  mainTableColumns.forEach((column) => {
    if (column === config.idColumn) return;
    if (column === 'globalid') return;
    if (column === config.geometry?.column) return;
    if (!Object.prototype.hasOwnProperty.call(record, column)) return;

    values.push(record[column]);
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
    if (!Object.prototype.hasOwnProperty.call(record, column)) return;

    insertColumns.push(column);
    values.push(record[column]);
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

async function getById(config, id, division) {
  const sql = `
    SELECT *
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

  const sql = `
    SELECT *
    FROM ${config.draftWorkflow.table}
    WHERE objectid = $1
      AND UPPER(division) = UPPER($2)
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
  const checkerAllowedStatuses = new Set(['Sent to Approver', 'Sent Back to Maker']);
  const approverAllowedStatuses = new Set(['Sent to Database', 'Sent Back to Maker']);
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
    const expectedCurrentStatus = normalizedUserType === 'checker' ? 'sent to checker' : 'sent to approver';
    if (currentStatus !== expectedCurrentStatus) {
      const err = new Error(
        normalizedUserType === 'checker'
          ? 'Only checker-pending drafts can be updated through this action'
          : 'Only approver-pending drafts can be updated through this action'
      );
      err.status = 400;
      throw err;
    }

    const assignedUserColumn = normalizedUserType === 'checker' ? workflow.checkerColumn : workflow.approverColumn;
    const assignedUser = String(draft?.[assignedUserColumn] || '').trim();
    if (assignedUser && assignedUser.toLowerCase() !== String(actingUserId || '').trim().toLowerCase()) {
      const err = new Error(
        normalizedUserType === 'checker'
          ? 'This draft is assigned to a different checker'
          : 'This draft is assigned to a different approver'
      );
      err.status = 403;
      throw err;
    }

    const draftTableColumns = await getTableColumns(client, workflow.table);
    const actingUserName = await getUserNameByUserId(client, actingUserId);
    const setClauses = [`${workflow.statusColumn} = $1`];
    const params = [normalizedStatus];

    if (draftTableColumns.includes('modified_by')) {
      params.push(actingUserName);
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

    let mainRecord = null;
    if (normalizedUserType === 'approver' && normalizedStatus === 'Sent to Database') {
      const mainTableColumns = await getTableColumns(client, config.table);
      const baseRecord = getStationBaseRecordFromDraft(config, draft, division);
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
    }

    await client.query('COMMIT');
    return {
      draft: rows[0],
      main: mainRecord,
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

  const nextId = config.idStrategy === 'manual'
    ? await getNextManualId(pool, config.table, config.idColumn)
    : null;

  values.push(nextId);
  placeholders.push(`$${values.length}`);

  values.push(generateGUID());
  placeholders.push(`$${values.length}`);

  config.insertFields.forEach((field) => {
    insertColumns.push(field);
    values.push(data[field] ?? null);
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

  config.updateFields.forEach((field, index) => {
    setClauses.push(`${field} = $${index + 1}`);
    params.push(data[field] ?? null);
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
    SELECT *
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

async function getDraftTable(config, page, pageSize, q, division, status) {
  if (!config.draftWorkflow) {
    const err = new Error('Draft workflow config not found for layer');
    err.status = 400;
    throw err;
  }

  const limit = Math.min(200, Math.max(1, Number(pageSize)));
  const offset = (Number(page) - 1) * limit;
  const params = [division];
  let where = `UPPER(division) = UPPER($1)`;

  if (status) {
    params.push(status);
    where += ` AND UPPER(status) = UPPER($${params.length})`;
  }

  if (q && config.searchableFields?.length) {
    params.push(`%${q}%`);
    const qIndex = params.length;
    const searchConditions = config.searchableFields
      .map((field) => `LOWER(${field}) LIKE LOWER($${qIndex})`)
      .join(' OR ');

    where += ` AND (${searchConditions})`;
  }

  const totalSql = `
    SELECT COUNT(*)::int AS total
    FROM ${config.draftWorkflow.table}
    WHERE ${where}
  `;

  const listSql = `
    SELECT *
    FROM ${config.draftWorkflow.table}
    WHERE ${where}
    ORDER BY objectid
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

function buildStationDraftInsert(draftTableColumns, config, record) {
  const insertColumns = [];
  const placeholders = [];
  const values = [];

  draftTableColumns.forEach((column) => {
    if (column === config.geometry?.column) return;
    if (!Object.prototype.hasOwnProperty.call(record, column)) return;
    const value = record[column];
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
      [workflow.originalIdColumn]: originalRow.gis_unique_id ?? null,
      [workflow.statusColumn]: workflow.draftStatusValue,
      [workflow.checkerColumn]: assignments.checkerUserId,
      [workflow.approverColumn]: assignments.approverUserId,
      edited_by: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('edited_by') ? assignments.makerUserName : undefined,
      edited_at: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('edited_at') ? '__NOW__' : undefined,
      modified_by: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('modified_by') ? assignments.makerUserName : undefined,
      modified_date: String(submittingUserType || '').toLowerCase() === 'maker' && draftTableColumns.includes('modified_date') ? '__NOW__' : undefined,
      objectid: draftTableColumns.includes('objectid') ? await getNextManualId(client, workflow.table, 'objectid') : undefined,
      globalid: draftTableColumns.includes('globalid') ? generateGUID() : undefined,
    };

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

    const updateOriginalSql = `
      UPDATE ${config.table}
      SET ${workflow.statusColumn} = $1
      WHERE ${config.idColumn} = $2
        AND UPPER(division) = UPPER($3)
      RETURNING *
    `;

    const { rows: originalRows } = await client.query(updateOriginalSql, [
      workflow.originalStatusValue,
      id,
      division,
    ]);

    await client.query('COMMIT');
    return {
      draft: rows[0],
      original: originalRows[0],
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
      [workflow.checkerColumn]: assignments.checkerUserId,
      [workflow.approverColumn]: assignments.approverUserId,
      edited_by: isMakerSubmit && draftTableColumns.includes('edited_by') ? assignments.makerUserName : undefined,
      edited_at: isMakerSubmit && draftTableColumns.includes('edited_at') ? '__NOW__' : undefined,
      created_by: isMakerSubmit && draftTableColumns.includes('created_by') ? assignments.makerUserName : undefined,
      created_date: isMakerSubmit && draftTableColumns.includes('created_date') ? '__NOW__' : undefined,
      objectid: nextDraftObjectId,
      globalid: draftTableColumns.includes('globalid') ? generateGUID() : undefined,
    };

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
  updateStationDraftStatus,
  create,
  update,
  remove,
  getTable,
  getDraftTable,
  validateStation,
  sendStationEdit,
  sendNewStationEdit,
};




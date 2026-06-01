// @ts-nocheck
const { exec }      = require('child_process');
const { promisify } = require('util');
const path          = require('path');
const { pool }      = require('../db/pool');
const { configuration } = require('../config/configuration.ts');
const fs = require('fs');
const os = require('os');
const execAsync = promisify(exec);
const config    = configuration();
const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'ogr2ogr';

const TEMP_DIR = process.env.UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'gis_uploads');
const TEMP_SELECTION_ID_COLUMN = '__selector_id';

function sanitizeLayerName(layerName, fallback) {
  const normalized = String(layerName || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return normalized || fallback;
}

function splitQualifiedLayerName(layerName) {
  const parts = String(layerName || '').split('.').filter(Boolean);
  if (parts.length >= 2) {
    return {
      schema: sanitizeLayerName(parts[0], config.UPLOADS.DEFAULT_SCHEMA || 'sde'),
      table:  sanitizeLayerName(parts[1], 'upload_layer'),
    };
  }
  return {
    schema: null,
    table:  sanitizeLayerName(layerName, 'upload_layer'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — KML FILE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function validateKmlFile(file) {
  const ext = path.extname(file.original_name).toLowerCase();
  if (!['.kml', '.kmz'].includes(ext)) {
    throw new Error(
      `KML upload requires a .kml or .kmz file. Received: "${file.original_name}"`,
    );
  }
}


async function loadKmlIntoTemp(filePath, tempTable, env) {
  const DB_HOST     = config.POSTGRES.DB_HOST;
  const DB_PORT     = config.POSTGRES.DB_PORT;
  const DB_NAME     = config.POSTGRES.DB_NAME;
  const DB_USER     = config.POSTGRES.USERNAME;
  const DB_PASSWORD = config.POSTGRES.PASSWORD;

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASSWORD}`;

  if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
  }
  console.log(`File size: ${fs.statSync(filePath).size} bytes`);
  const cmd = [
    `"${OGR2OGR_PATH}"`,
    '-f "PostgreSQL"',
    `"${pgConn}"`,
    `"${filePath}"`,
    `-nln public."${tempTable}"`,
    '-overwrite',
    '-lco GEOMETRY_NAME=geom',
    '-lco FID=gid',
    '-t_srs EPSG:4326',
    '-nlt PROMOTE_TO_MULTI',
    '-lco GEOMETRY_TYPE=GEOMETRY',
    '-explodecollections',
  ].join(' ');

  const { stderr } = await execAsync(cmd, {
    env:       { ...env, PGPASSWORD: DB_PASSWORD },
    maxBuffer: 50 * 1024 * 1024,
  });

  if (stderr) console.log('[ogr2ogr] output:', stderr);

  await pruneTempTableToLines(tempTable);
}

function getKmlTempTableName(layerName, uploadId) {
  const requestedLayerName = sanitizeLayerName(layerName, 'layer');
  return `_temp_${requestedLayerName}_${uploadId.replace(/-/g, '').slice(0, 8)}`;
}

async function pruneTempTableToLines(tempTable) {
  const geomCol = await getGeometryColumn('public', tempTable);
  if (!geomCol) {
    throw new Error(`No geometry column found in temp table: ${tempTable}`);
  }

  // Step 1 — remove non-line geometries
  await pool.query(`
    DELETE FROM public."${tempTable}"
    WHERE "${geomCol}" IS NULL
      OR GeometryType("${geomCol}") NOT IN ('LINESTRING', 'MULTILINESTRING')
  `);

  // Step 2 — remove label/annotation boxes
  // These are rectangular closed lines with very small bounding boxes
  await pool.query(`
    DELETE FROM public."${tempTable}"
    WHERE ST_IsClosed("${geomCol}")        -- closed loop = likely a label box
      AND ST_NPoints("${geomCol}") <= 5    -- rectangles have 4-5 points
  `);

  // Step 3 — remove extremely short lines (noise/dimension lines)
  await pool.query(`
    DELETE FROM public."${tempTable}"
    WHERE ST_Length(
      ST_Transform("${geomCol}"::geometry, 3857)
    ) < 100   -- remove lines shorter than 100 metres
  `);
}

async function importKmlToTemp(file, uploadId, layerNameFromRequest) {
  const fallback           = `layer_${uploadId.replace(/-/g, '').slice(0, 12)}`;
  const requestedLayerName = sanitizeLayerName(layerNameFromRequest, fallback);
  const target             = await resolveTargetTable(requestedLayerName);

  validateKmlFile(file);

  const tempTable = getKmlTempTableName(requestedLayerName, uploadId);
  const env       = { ...process.env };

  await loadKmlIntoTemp(file.disk_path, tempTable, env);
  await ensureTempSelectionIds(tempTable);

  const geometryColumn = await getGeometryColumn('public', tempTable);
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public."${tempTable}"`,
  );

  return {
    tempTable,
    tempSchema:      'public',
    targetSchema:    target.table_schema,
    targetTable:     target.table_name,
    targetExists:    target.exists,
    geometryColumn,
    featureCount:    Number(countRows[0]?.count || 0),
  };
}

async function getTempKmlLineFeatures(tempTable) {
  await ensureTempSelectionIds(tempTable);

  const geomCol = await getGeometryColumn('public', tempTable);
  if (!geomCol) {
    throw new Error(`No geometry column found in temp table: ${tempTable}`);
  }

  const { rows } = await pool.query(
    `SELECT
       t."${TEMP_SELECTION_ID_COLUMN}"::int AS feature_id,
       ST_AsGeoJSON(t."${geomCol}") AS geometry,
       (to_jsonb(t) - '${geomCol}' - '${TEMP_SELECTION_ID_COLUMN}') AS properties
     FROM public."${tempTable}" AS t
     WHERE t."${geomCol}" IS NOT NULL
     ORDER BY t."${TEMP_SELECTION_ID_COLUMN}" ASC`,
  );

  return rows.map((row) => {
    const geometry = row.geometry ? JSON.parse(row.geometry) : null;
    return {
      type: 'Feature',
      id: row.feature_id,
      geometry,
      properties: row.properties || {},
    };
  });
}

async function appendSelectedKmlLines(tempTable, targetLayerName, selectedIds) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw new Error('selectedIds must be a non-empty array');
  }

  await ensureTempSelectionIds(tempTable);

  const target = await resolveTargetTable(targetLayerName);
  const sourceGeomCol = await getGeometryColumn('public', tempTable);
  const sourceColumns = await getTableColumns('public', tempTable);

  const { rows: selectedRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public."${tempTable}" WHERE "${TEMP_SELECTION_ID_COLUMN}" = ANY($1::int[])`,
    [selectedIds],
  );
  const selectedCount = Number(selectedRows[0]?.count || 0);
  if (selectedCount === 0) {
    throw new Error('No matching selected rows were found in the temp table');
  }

  if (!target.exists) {
    const columnList = sourceColumns
      .map((col) => `"${col.column_name}"`)
      .concat(`"${sourceGeomCol}"`)
      .join(', ');

    await pool.query(`
      CREATE TABLE "${target.table_schema}"."${target.table_name}" AS
      SELECT ${columnList}
      FROM public."${tempTable}"
      WHERE "${TEMP_SELECTION_ID_COLUMN}" = ANY($1::int[])
    `, [selectedIds]);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "${target.table_name}_geom_idx"
      ON "${target.table_schema}"."${target.table_name}" USING GIST ("${sourceGeomCol}")
    `);
    await pool.query(
      `SELECT UpdateGeometrySRID('${target.table_schema}', '${target.table_name}', '${sourceGeomCol}', 4326)`,
    );
  } else {
    const targetGeomCol = await getGeometryColumn(target.table_schema, target.table_name);
    const targetColumns = await getTableColumns(target.table_schema, target.table_name);
    const { mapping } = autoMapColumns(sourceColumns, targetColumns);
    const hasObjectId = await hasColumn(target.table_schema, target.table_name, 'objectid');

    const insertColumns = [];
    const selectExpressions = [];

    if (hasObjectId) {
      const maxOid = await getMaxObjectId(target.table_schema, target.table_name);
      insertColumns.push('"objectid"');
      selectExpressions.push(`${maxOid} + ROW_NUMBER() OVER (ORDER BY "gid") AS "objectid"`);
    }

    for (const m of mapping) {
      insertColumns.push(`"${m.targetCol}"`);
      selectExpressions.push(m.selectExpr);
    }

    insertColumns.push(`"${targetGeomCol}"`);
    selectExpressions.push(
      `ST_SetSRID(ST_Transform("${sourceGeomCol}"::geometry, 4326), 4326) AS "${targetGeomCol}"`,
    );

    await pool.query(`
      INSERT INTO "${target.table_schema}"."${target.table_name}" (
        ${insertColumns.join(',\n        ')}
      )
      SELECT
        ${selectExpressions.join(',\n        ')}
      FROM public."${tempTable}"
      WHERE "${TEMP_SELECTION_ID_COLUMN}" = ANY($1::int[])
    `, [selectedIds]);
  }

  await dropTempTable(tempTable);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM "${target.table_schema}"."${target.table_name}"`,
  );

  return {
    success: true,
    insertedCount: selectedCount,
    targetSchema: target.table_schema,
    targetTable: target.table_name,
    totalRows: Number(countRows[0]?.count || 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — DATABASE HELPERS (identical to shapefile service)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveTargetTable(layerName) {
  const parsed = splitQualifiedLayerName(layerName);

  if (parsed.schema) {
    const { rows } = await pool.query(
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
       LIMIT 1`,
      [parsed.schema, parsed.table],
    );
    return rows[0]
      ? { ...rows[0], exists: true }
      : { table_schema: parsed.schema, table_name: parsed.table, exists: false };
  }

  const preferredSchemas = [
    ...new Set([config.UPLOADS.DEFAULT_SCHEMA || 'sde', 'public']),
  ];

  const { rows } = await pool.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_name = $1
       AND table_schema = ANY($2::text[])
     ORDER BY CASE
       WHEN table_schema = $3 THEN 0
       WHEN table_schema = 'public' THEN 1
       ELSE 2
     END
     LIMIT 1`,
    [parsed.table, preferredSchemas, config.UPLOADS.DEFAULT_SCHEMA || 'sde'],
  );

  return rows[0]
    ? { ...rows[0], exists: true }
    : {
        table_schema: parsed.schema || config.UPLOADS.DEFAULT_SCHEMA || 'sde',
        table_name:   parsed.table,
        exists:       false,
      };
}

async function getGeometryColumn(schema, table) {
  try {
    const { rows } = await pool.query(
      `SELECT f_geometry_column
       FROM public.geometry_columns
       WHERE f_table_schema = $1 AND f_table_name = $2
       LIMIT 1`,
      [schema, table],
    );
    if (rows[0]?.f_geometry_column) return rows[0].f_geometry_column;
  } catch (_) {}

  try {
    const { rows } = await pool.query(
      `SELECT a.attname AS column_name
       FROM pg_attribute a
       JOIN pg_class     c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type      t ON t.oid = a.atttypid
       WHERE n.nspname = $1 AND c.relname = $2
         AND a.attnum > 0 AND NOT a.attisdropped
         AND t.typname IN ('geometry', 'geography')
       ORDER BY a.attnum LIMIT 1`,
      [schema, table],
    );
    if (rows[0]?.column_name) return rows[0].column_name;
  } catch (_) {}

  try {
    const { rows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
         AND lower(column_name) = ANY(ARRAY['shape','geom','the_geom','wkb_geometry','geometry'])
       ORDER BY CASE lower(column_name)
         WHEN 'shape' THEN 0 WHEN 'geom' THEN 1 ELSE 2 END
       LIMIT 1`,
      [schema, table],
    );
    if (rows[0]?.column_name) return rows[0].column_name;
  } catch (_) {}

  return 'geom';
}

async function ensureTempSelectionIds(tempTable) {
  await pool.query(`
    ALTER TABLE public."${tempTable}"
    ADD COLUMN IF NOT EXISTS "${TEMP_SELECTION_ID_COLUMN}" bigint
  `);

  await pool.query(`
    WITH numbered AS (
      SELECT
        ctid,
        ROW_NUMBER() OVER (ORDER BY ctid)::bigint AS selector_id
      FROM public."${tempTable}"
    )
    UPDATE public."${tempTable}" AS target
    SET "${TEMP_SELECTION_ID_COLUMN}" = numbered.selector_id
    FROM numbered
    WHERE target.ctid = numbered.ctid
      AND target."${TEMP_SELECTION_ID_COLUMN}" IS NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "${tempTable}_${TEMP_SELECTION_ID_COLUMN}_idx"
    ON public."${tempTable}" ("${TEMP_SELECTION_ID_COLUMN}")
  `);
}

async function hasColumn(schema, table, columnName) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
       AND lower(column_name) = lower($3)
     LIMIT 1`,
    [schema, table, columnName],
  );
  return rows.length > 0;
}

async function getTableColumns(schema, table) {
  const geomCol = await getGeometryColumn(schema, table);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  );

  const ALWAYS_EXCLUDE = new Set([
    'objectid', 'ogc_fid', 'shape_length', 'shape_area',
    TEMP_SELECTION_ID_COLUMN,
  ]);
  const GEOM_NAMES = new Set([
    'shape', 'geom', 'the_geom', 'wkb_geometry', 'geometry',
  ]);

  return rows.filter((row) => {
    const name = row.column_name.toLowerCase();
    return (
      name !== geomCol.toLowerCase() &&
      !ALWAYS_EXCLUDE.has(name)      &&
      !GEOM_NAMES.has(name)          &&
      row.data_type !== 'USER-DEFINED'
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — TYPE CASTING (identical to shapefile service)
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_CAST_MAP = {
  'character varying|integer':          (c) => `"${c}"::integer`,
  'character varying|bigint':           (c) => `"${c}"::bigint`,
  'character varying|numeric':          (c) => `"${c}"::numeric`,
  'character varying|double precision': (c) => `"${c}"::double precision`,
  'character varying|real':             (c) => `"${c}"::real`,
  'character varying|boolean':          (c) => `"${c}"::boolean`,
  'character varying|date': (c) =>
    `CASE WHEN "${c}" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN "${c}"::date ELSE NULL END`,
  'character varying|timestamp without time zone': (c) =>
    `CASE WHEN "${c}" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN "${c}"::timestamp ELSE NULL END`,
  'character varying|timestamp with time zone': (c) =>
    `CASE WHEN "${c}" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN "${c}"::timestamptz ELSE NULL END`,
  'date|character varying':             (c) => `"${c}"::character varying`,
  'integer|character varying':          (c) => `"${c}"::character varying`,
  'integer|numeric':                    (c) => `"${c}"::numeric`,
  'integer|bigint':                     (c) => `"${c}"::bigint`,
  'integer|double precision':           (c) => `"${c}"::double precision`,
  'bigint|integer':                     (c) => `"${c}"::integer`,
  'bigint|character varying':           (c) => `"${c}"::character varying`,
  'numeric|character varying':          (c) => `"${c}"::character varying`,
  'numeric|integer':                    (c) => `"${c}"::integer`,
  'numeric|double precision':           (c) => `"${c}"::double precision`,
  'double precision|character varying': (c) => `"${c}"::character varying`,
  'double precision|numeric':           (c) => `"${c}"::numeric`,
  'double precision|integer':           (c) => `"${c}"::integer`,
};

function getCastExpression(sourceCol, sourceType, targetType) {
  if (sourceType === targetType) return `"${sourceCol}"`;
  const fn = TYPE_CAST_MAP[`${sourceType}|${targetType}`];
  return fn ? fn(sourceCol) : `"${sourceCol}"::${targetType}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — AUTO-FILL + MAPPING (identical to shapefile service)
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_FILL_EXPRESSIONS = {
  globalid:            `sde.next_globalid()`,
  created_date:        `NOW()`,
  final_modified_date: `NOW()`,
  created_by:          `'UPLOAD'`,
  final_modified_by:   `'UPLOAD'`,
  status:              `'A'`,
  valid:               `'Y'`,
  expired_flag:        `'N'`,
  mapped_flag:         `'N'`,
};

function autoMapColumns(sourceColumns, targetColumns) {
  const sourceLookup = {};
  for (const col of sourceColumns) {
    sourceLookup[col.column_name.toLowerCase()] = col;
  }

  const claimedSourceCols = new Set();
  const mapping           = [];
  const nulledColumns     = [];
  const autofillColumns   = [];
  const ignoredColumns    = [];

  for (const target of targetColumns) {
    const targetName = target.column_name.toLowerCase();

    if (['objectid', 'shape', 'geom', 'the_geom', 'wkb_geometry', 'ogc_fid'].includes(targetName)) {
      continue;
    }

    let sourceCol = sourceLookup[targetName];
    let matchType = 'exact';

    if (!sourceCol) {
      sourceCol = sourceLookup[targetName.substring(0, 10)];
      matchType = 'truncation';
    }

    if (!sourceCol) {
      const prefix8 = targetName.substring(0, 8);
      sourceCol = Object.values(sourceLookup).find(
        (s) => s.column_name.toLowerCase().startsWith(prefix8),
      );
      matchType = 'partial';
    }

    if (sourceCol && claimedSourceCols.has(sourceCol.column_name.toLowerCase())) {
      console.warn(`[autoMap] "${sourceCol.column_name}" already claimed — "${target.column_name}" → autofill/NULL.`);
      sourceCol = null;
    }

    if (sourceCol) {
      claimedSourceCols.add(sourceCol.column_name.toLowerCase());
      const castExpr = getCastExpression(
        sourceCol.column_name, sourceCol.data_type, target.data_type,
      );
      mapping.push({
        targetCol:  target.column_name,
        targetType: target.data_type,
        sourceCol:  sourceCol.column_name,
        sourceType: sourceCol.data_type,
        matchType,
        needsCast:  sourceCol.data_type !== target.data_type,
        selectExpr: `${castExpr} AS "${target.column_name}"`,
        status:     'mapped',
      });
    } else {
      const isNotNull    = target.is_nullable === 'NO';
      const autoFillExpr = AUTO_FILL_EXPRESSIONS[targetName];

      if (autoFillExpr) {
        autofillColumns.push(target.column_name);
        mapping.push({
          targetCol:  target.column_name,
          targetType: target.data_type,
          sourceCol:  null,
          matchType:  'autofill',
          needsCast:  false,
          selectExpr: `${autoFillExpr} AS "${target.column_name}"`,
          status:     'autofill',
        });
      } else {
        if (isNotNull) {
          console.warn(`[autoMap] "${target.column_name}" is NOT NULL — add to AUTO_FILL_EXPRESSIONS if inserts fail.`);
        }
        nulledColumns.push(target.column_name);
        mapping.push({
          targetCol:  target.column_name,
          targetType: target.data_type,
          sourceCol:  null,
          matchType:  'none',
          needsCast:  false,
          selectExpr: `NULL::${target.data_type} AS "${target.column_name}"`,
          status:     'null',
        });
      }
    }
  }

  const usedSourceCols = new Set(mapping.map((m) => m.sourceCol).filter(Boolean));
  for (const src of sourceColumns) {
    if (!usedSourceCols.has(src.column_name)) ignoredColumns.push(src.column_name);
  }

  return { mapping, nulledColumns, autofillColumns, ignoredColumns };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — OBJECTID
// ─────────────────────────────────────────────────────────────────────────────

async function getMaxObjectId(schema, table) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(objectid), 0) AS max_oid FROM "${schema}"."${table}"`,
    );
    return Number(rows[0]?.max_oid || 0);
  } catch (_) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — MIGRATE TEMP → SDE (identical to shapefile service)
// ─────────────────────────────────────────────────────────────────────────────

async function migrateTempToSde(tempSchema, tempTable, sdeSchema, sdeTable, isNew) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sourceGeomCol = await getGeometryColumn(tempSchema, tempTable);
    const targetGeomCol = isNew
      ? sourceGeomCol
      : await getGeometryColumn(sdeSchema, sdeTable);

    let mapping, nulledColumns, autofillColumns, ignoredColumns;

    if (isNew) {
      const sourceColumns = await getTableColumns(tempSchema, tempTable);
      mapping = sourceColumns.map((col) => ({
        targetCol:  col.column_name,
        targetType: col.data_type,
        sourceCol:  col.column_name,
        sourceType: col.data_type,
        matchType:  'exact',
        needsCast:  false,
        selectExpr: `"${col.column_name}"`,
        status:     'mapped',
      }));
      nulledColumns  = [];
      autofillColumns = [];
      ignoredColumns = [];
    } else {
      const sourceColumns = await getTableColumns(tempSchema, tempTable);
      const targetColumns = await getTableColumns(sdeSchema, sdeTable);
      ({ mapping, nulledColumns, autofillColumns, ignoredColumns } =
        autoMapColumns(sourceColumns, targetColumns));
    }

    console.log(`\n${'═'.repeat(62)}`);
    console.log(`  KML Migration: ${tempSchema}.${tempTable} → ${sdeSchema}.${sdeTable}`);
    console.log(`  Mode: ${isNew ? 'CREATE NEW TABLE' : 'APPEND TO EXISTING'}`);
    console.log(`─${'─'.repeat(61)}`);
    console.log(
      `  Mapped   (${mapping.filter((m) => m.status === 'mapped').length}): ` +
      mapping.filter((m) => m.status === 'mapped')
        .map((m) => `${m.sourceCol}→${m.targetCol}${m.needsCast ? ' [cast]' : ''}`)
        .join(', '),
    );
    if (autofillColumns.length) console.log(`  AutoFill (${autofillColumns.length}): ${autofillColumns.join(', ')}`);
    if (nulledColumns.length)   console.log(`  NULL     (${nulledColumns.length}): ${nulledColumns.join(', ')}`);
    if (ignoredColumns.length)  console.log(`  Ignored  (${ignoredColumns.length}): ${ignoredColumns.join(', ')}`);
    console.log(`  Geometry: "${sourceGeomCol}" → "${targetGeomCol}"`);
    console.log(`${'═'.repeat(62)}\n`);

    const insertColumns     = [];
    const selectExpressions = [];

    if (!isNew) {
      const maxOid = await getMaxObjectId(sdeSchema, sdeTable);
      insertColumns.push('objectid');
      selectExpressions.push(
        `${maxOid} + ROW_NUMBER() OVER (ORDER BY "gid") AS objectid`,
      );
    }

    for (const m of mapping) {
      insertColumns.push(`"${m.targetCol}"`);
      selectExpressions.push(m.selectExpr);
    }

    insertColumns.push(`"${targetGeomCol}"`);
    selectExpressions.push(
      `ST_SetSRID(ST_Transform("${sourceGeomCol}"::geometry, 4326), 4326) AS "${targetGeomCol}"`,
    );

    if (isNew) {
      await client.query(`
        CREATE TABLE "${sdeSchema}"."${sdeTable}" AS
        SELECT
          ROW_NUMBER() OVER (ORDER BY "gid") AS objectid,
          ${selectExpressions.join(',\n          ')}
        FROM "${tempSchema}"."${tempTable}"
        WHERE "${sourceGeomCol}" IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "${sdeTable}_geom_idx"
        ON "${sdeSchema}"."${sdeTable}" USING GIST ("${targetGeomCol}")
      `);
      await client.query(
        `SELECT UpdateGeometrySRID('${sdeSchema}', '${sdeTable}', '${targetGeomCol}', 4326)`,
      );
    } else {
      await client.query(`
        INSERT INTO "${sdeSchema}"."${sdeTable}" (
          ${insertColumns.join(',\n          ')}
        )
        SELECT
          ${selectExpressions.join(',\n          ')}
        FROM "${tempSchema}"."${tempTable}"
        WHERE "${sourceGeomCol}" IS NOT NULL
      `);
    }

    await client.query('COMMIT');

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM "${sdeSchema}"."${sdeTable}"`,
    );

    return {
      success:         true,
      totalRows:       Number(countRows[0]?.count || 0),
      mapping,
      nulledColumns,
      autofillColumns,
      ignoredColumns,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && error.constraint?.startsWith('uuid_')) {
      throw new Error(
        `Duplicate records detected — these records already exist in "${sdeTable}". ` +
        `The KML contains records that were previously uploaded.`,
      );
    }
    console.error('[kml migrate] Failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — STANDARD COLUMNS + CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

async function ensureStandardColumns(schema, table) {
  await pool.query(`
    ALTER TABLE "${schema}"."${table}"
    ADD COLUMN IF NOT EXISTS attachment_bundle_url text
  `);
  const geomCol = await getGeometryColumn(schema, table);
  if (geomCol) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "${table}_geom_gist"
      ON "${schema}"."${table}" USING GIST ("${geomCol}")
    `);
  }
}

async function dropTempTable(tempTable) {
  try {
    await pool.query(`DROP TABLE IF EXISTS public."${tempTable}"`);
    console.log(`[cleanup] Dropped: public.${tempTable}`);
  } catch (err) {
    console.warn('[cleanup] Could not drop temp table:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

async function importKmlToPostGIS(file, uploadId, layerNameFromRequest) {
  const fallback           = `layer_${uploadId.replace(/-/g, '').slice(0, 12)}`;
  const requestedLayerName = sanitizeLayerName(layerNameFromRequest, fallback);
  const target             = await resolveTargetTable(requestedLayerName);

  validateKmlFile(file);

  const tempTable = `_temp_${sanitizeLayerName(requestedLayerName, 'layer')}_${uploadId.replace(/-/g, '').slice(0, 8)}`;
  const env       = { ...process.env };

  try {
    // Step 1 — ogr2ogr loads KML/KMZ → public._temp_*
    await loadKmlIntoTemp(file.disk_path, tempTable, env);

    // Step 2 — auto-map + migrate temp → SDE
    console.log(`[kml] Migrating → ${target.table_schema}.${target.table_name}`);
    const result = await migrateTempToSde(
      'public',
      tempTable,
      target.table_schema,
      target.table_name,
      !target.exists,
    );

    // Step 3 — ensure standard columns
    await ensureStandardColumns(target.table_schema, target.table_name);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM "${target.table_schema}"."${target.table_name}"`,
    );
    const totalRows = Number(countRows[0]?.count || 0);

    console.log(`[kml] ✅ Done — total rows: ${totalRows}`);

    return {
      layerName:      target.table_name,
      targetSchema:   target.table_schema,
      targetTable:    target.table_name,
      geometryColumn: await getGeometryColumn(target.table_schema, target.table_name),
      featureCount:   totalRows,
      mapping: {
        mapped:   result.mapping.filter((m) => m.status === 'mapped').length,
        autofill: result.autofillColumns,
        nulled:   result.nulledColumns,
        ignored:  result.ignoredColumns,
      },
    };

  } finally {
    await dropTempTable(tempTable);
  }
}

async function appendMergedKmlLines(tempTable, targetLayerName, selectedIds) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw new Error('selectedIds must be a non-empty array');
  }

  await ensureTempSelectionIds(tempTable);

  const target        = await resolveTargetTable(targetLayerName);
  const sourceGeomCol = await getGeometryColumn('public', tempTable);

  // ── Verify rows exist ───────────────────────────────────────────────────
  const { rows: countCheck } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM public."${tempTable}"
     WHERE "${TEMP_SELECTION_ID_COLUMN}" = ANY($1::int[])`,
    [selectedIds],
  );
  if (Number(countCheck[0]?.count || 0) === 0) {
    throw new Error('No matching selected rows found in temp table');
  }

  // ── Collect all → snap collection to itself → LineMerge ─────────────────
 const { rows: mergedRows } = await pool.query(
    `WITH collected AS (
       SELECT ST_Collect(
         ST_SetSRID(ST_Transform("${sourceGeomCol}"::geometry, 4326), 4326)
       ) AS geom
       FROM public."${tempTable}"
       WHERE "${TEMP_SELECTION_ID_COLUMN}" = ANY($1::int[])
     ),
     snapped AS (
       SELECT ST_Snap(geom, geom, 0.0001) AS geom
       FROM collected
     )
     SELECT
       ST_AsEWKB(ST_LineMerge(geom))        AS merged_geom,
       ST_GeometryType(ST_LineMerge(geom))  AS geom_type,
       ST_NumGeometries(ST_LineMerge(geom)) AS num_parts
     FROM snapped`,
    [selectedIds],
  );

  const mergedGeom = mergedRows[0]?.merged_geom;
  const geomType   = mergedRows[0]?.geom_type;
  const numParts   = Number(mergedRows[0]?.num_parts || 1);
  const hasGaps    = geomType !== 'ST_LineString';

  if (!mergedGeom) {
    throw new Error('Merge produced no geometry — check if selected lines are valid');
  }

  console.log(`[kml merge] type=${geomType}, parts=${numParts}, hasGaps=${hasGaps}`);

  if (!target.exists) {
    // ── CREATE new table with single merged row ──────────────────────────
    const targetGeomCol = sourceGeomCol;
    await pool.query(`
      CREATE TABLE "${target.table_schema}"."${target.table_name}" (
        objectid          bigint,
        "${targetGeomCol}" geometry(Geometry, 4326)
      )
    `);
    await pool.query(`
      INSERT INTO "${target.table_schema}"."${target.table_name}"
        (objectid, "${targetGeomCol}")
      VALUES (1, ST_GeomFromEWKB($1))
    `, [mergedGeom]);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "${target.table_name}_geom_idx"
      ON "${target.table_schema}"."${target.table_name}"
      USING GIST ("${targetGeomCol}")
    `);
  } else {
    // ── APPEND one merged row to existing sde.track_table ───────────────
    const targetGeomCol = await getGeometryColumn(target.table_schema, target.table_name);
    const hasObjectId   = await hasColumn(target.table_schema, target.table_name, 'objectid');

    if (hasObjectId) {
      const maxOid = await getMaxObjectId(target.table_schema, target.table_name);
      await pool.query(`
        INSERT INTO "${target.table_schema}"."${target.table_name}"
          (objectid, "${targetGeomCol}")
        VALUES ($1, ST_GeomFromEWKB($2))
      `, [maxOid + 1, mergedGeom]);
    } else {
      await pool.query(`
        INSERT INTO "${target.table_schema}"."${target.table_name}"
          ("${targetGeomCol}")
        VALUES (ST_GeomFromEWKB($1))
      `, [mergedGeom]);
    }
  }

  await dropTempTable(tempTable);

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM "${target.table_schema}"."${target.table_name}"`,
  );

  return {
    success:         true,
    insertedCount:   1,
    mergedFromCount: selectedIds.length,
    targetSchema:    target.table_schema,
    targetTable:     target.table_name,
    totalRows:       Number(totalRows[0]?.count || 0),
    resultType:      geomType,
    segmentCount:    numParts,
    hasGaps,
  };
}

module.exports = {
  importKmlToPostGIS,
  importKmlToTemp,
  getTempKmlLineFeatures,
  appendSelectedKmlLines,
  getKmlTempTableName,
  appendMergedKmlLines,
};

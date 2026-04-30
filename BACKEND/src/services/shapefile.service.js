// @ts-nocheck
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/pool');
const { configuration } = require('../config/configuration.ts');

const execAsync = promisify(exec);
const config = configuration();

const PG_BIN = config.POSTGRES.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin';
const SHP2PGSQL = `"${PG_BIN}\\shp2pgsql"`;
const PSQL = `"${PG_BIN}\\psql"`;
const OGR2OGR = 'ogr2ogr';


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
      table: sanitizeLayerName(parts[1], 'upload_layer'),
    };
  }
  return {
    schema: null,
    table: sanitizeLayerName(layerName, 'upload_layer'),
  };
}

function removeDirSafe(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_) {}
}

function makeWorkingCopies(files, uploadId) {
  const shpFile = files.find((file) => path.extname(file.original_name).toLowerCase() === '.shp');
  if (!shpFile) throw new Error('.shp file is required for shapefile import');

  const sourceDir = path.dirname(shpFile.disk_path);
  const workDir = path.join(sourceDir, '_import');
  const baseName = `upload_${uploadId.replace(/-/g, '')}`;

  fs.mkdirSync(workDir, { recursive: true });

  for (const file of files) {
    const ext = path.extname(file.original_name).toLowerCase();
    const workPath = path.join(workDir, `${baseName}${ext}`);
    fs.copyFileSync(file.disk_path, workPath);
  }

  return {
    workDir,
    shpPath: path.join(workDir, `${baseName}.shp`),
  };
}

function validateShapefileBundle(files) {
  const requiredExts = ['.shp', '.dbf', '.shx'];
  const partsByBase = files.reduce((acc, file) => {
    const ext = path.extname(file.original_name).toLowerCase();
    if (!requiredExts.includes(ext)) return acc;
    const base = path.basename(file.original_name, ext).trim().toLowerCase();
    if (!acc[base]) acc[base] = new Set();
    acc[base].add(ext);
    return acc;
  }, {});

  const validBundle = Object.values(partsByBase).some((exts) =>
    requiredExts.every((ext) => exts.has(ext)),
  );

  if (!validBundle) {
    const missingExts = requiredExts.filter(
      (ext) => !files.some((file) => path.extname(file.original_name).toLowerCase() === ext),
    );
    throw new Error(
      `Shapefile upload requires matching ${requiredExts.join(', ')} files. Missing: ${missingExts.join(', ') || 'one or more required parts'}.`,
    );
  }
}



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
    if (!rows[0]) {
      return { table_schema: parsed.schema, table_name: parsed.table, exists: false };
    }
    return { ...rows[0], exists: true };
  }

  const preferredSchemas = Array.from(
    new Set([config.UPLOADS.DEFAULT_SCHEMA || 'sde', 'public']),
  );

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

  if (!rows[0]) {
    return {
      table_schema: parsed.schema || config.UPLOADS.DEFAULT_SCHEMA || 'sde',
      table_name: parsed.table,
      exists: false,
    };
  }
  return { ...rows[0], exists: true };
}

async function getGeometryColumn(schema, table) {
  // Step 1: Ask PostGIS geometry_columns view 
  try {
    const { rows } = await pool.query(
      `SELECT f_geometry_column
       FROM public.geometry_columns
       WHERE f_table_schema = $1 AND f_table_name = $2
       LIMIT 1`,
      [schema, table],
    );
    if (rows[0]?.f_geometry_column) {
      console.log(`[getGeometryColumn] ${schema}.${table} → "${rows[0].f_geometry_column}" (from geometry_columns)`);
      return rows[0].f_geometry_column;
    }
  } catch (_) {}

  //  Step 2: Look for actual PostGIS geometry type via pg_type 
  try {
    const { rows } = await pool.query(
      `SELECT a.attname AS column_name
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       WHERE n.nspname = $1 AND c.relname = $2
         AND a.attnum > 0 AND NOT a.attisdropped
         AND t.typname IN ('geometry', 'geography')
       ORDER BY a.attnum
       LIMIT 1`,
      [schema, table],
    );
    if (rows[0]?.column_name) {
      console.log(`[getGeometryColumn] ${schema}.${table} → "${rows[0].column_name}" (from pg_type)`);
      return rows[0].column_name;
    }
  } catch (_) {}

  try {
    const { rows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
         AND lower(column_name) = ANY(ARRAY['shape','geom','the_geom','wkb_geometry','geometry'])
       ORDER BY CASE lower(column_name)
         WHEN 'shape'        THEN 0
         WHEN 'geom'         THEN 1
         WHEN 'the_geom'     THEN 2
         WHEN 'wkb_geometry' THEN 3
         ELSE 4
       END
       LIMIT 1`,
      [schema, table],
    );
    if (rows[0]?.column_name) {
      console.log(`[getGeometryColumn] ${schema}.${table} → "${rows[0].column_name}" (name fallback)`);
      return rows[0].column_name;
    }
  } catch (_) {}

  console.warn(`[getGeometryColumn] Could not detect geometry column for ${schema}.${table}, defaulting to "geom"`);
  return 'geom';
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

  const ALWAYS_EXCLUDE = new Set(['objectid', 'ogc_fid', 'shape_length', 'shape_area',]);
  const GEOM_NAMES = new Set(['shape', 'geom', 'the_geom', 'wkb_geometry', 'geometry']);

  return rows.filter((row) => {
    const name = row.column_name.toLowerCase();
    return (
      name !== geomCol.toLowerCase() &&
      !ALWAYS_EXCLUDE.has(name) &&
      !GEOM_NAMES.has(name) &&
      row.data_type !== 'USER-DEFINED'
    );
  });
}

// AUTO COLUMN MAPPING and  Timestamp-safe cast patterns.

const TYPE_CAST_MAP = {
  // ── varchar → numeric types ──────────────────────────────────────────────
  'character varying|integer':          (c) => `"${c}"::integer`,
  'character varying|bigint':           (c) => `"${c}"::bigint`,
  'character varying|numeric':          (c) => `"${c}"::numeric`,
  'character varying|double precision': (c) => `"${c}"::double precision`,
  'character varying|real':             (c) => `"${c}"::real`,
  'character varying|boolean':          (c) => `"${c}"::boolean`,

  // ── varchar → temporal types (SAFE — guard against non-date strings) ─────
  'character varying|date': (c) =>
    `CASE WHEN "${c}" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN "${c}"::date ELSE NULL END`,

  'character varying|timestamp without time zone': (c) =>
    `CASE WHEN "${c}" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN "${c}"::timestamp ELSE NULL END`,

  'character varying|timestamp with time zone': (c) =>
    `CASE WHEN "${c}" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN "${c}"::timestamptz ELSE NULL END`,

  //  date → varchar 
  'date|character varying': (c) => `"${c}"::character varying`,

  //  numeric → varchar / other numeric 
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
  const key = `${sourceType}|${targetType}`;
  const fn = TYPE_CAST_MAP[key];
  if (fn) return fn(sourceCol);
  // Generic fallback
  return `"${sourceCol}"::${targetType}`;
}


// Auto-mapping logic to align shapefile columns to target SDE table columns, with sensible defaults and safeguards to prevent common issues like duplicate mappings and null value errors on NOT NULL columns.
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


// Auto-map temp table columns to target SDE table columns.

function autoMapColumns(sourceColumns, targetColumns) {

  const sourceLookup = {};
  for (const col of sourceColumns) {
    sourceLookup[col.column_name.toLowerCase()] = col;
  }
  const claimedSourceCols = new Set();

  const mapping = [];
  const nulledColumns = [];
  const autofillColumns = [];
  const ignoredColumns = [];

  for (const target of targetColumns) {
    const targetName = target.column_name.toLowerCase();

    if (['objectid', 'shape', 'geom', 'the_geom', 'wkb_geometry', 'ogc_fid'].includes(targetName)) {
      continue;
    }

    let sourceCol = sourceLookup[targetName];
    let matchType = 'exact';

    if (!sourceCol) {
      const truncated = targetName.substring(0, 10);
      sourceCol = sourceLookup[truncated];
      matchType = 'truncation';
    }

    if (!sourceCol) {
      const prefix8 = targetName.substring(0, 8);
      sourceCol = Object.values(sourceLookup).find((s) =>
        s.column_name.toLowerCase().startsWith(prefix8),
      );
      matchType = 'partial';
    }
    if (sourceCol && claimedSourceCols.has(sourceCol.column_name.toLowerCase())) {
      console.warn(
        `[autoMapColumns] Source column "${sourceCol.column_name}" already claimed; ` +
        `mapping target "${target.column_name}" → NULL/autofill to avoid duplicate mapping.`,
      );
      sourceCol = null;
    }

    if (sourceCol) {
      claimedSourceCols.add(sourceCol.column_name.toLowerCase());

      const needsCast = sourceCol.data_type !== target.data_type;
      const castExpr = getCastExpression(sourceCol.column_name, sourceCol.data_type, target.data_type);

      mapping.push({
        targetCol:  target.column_name,
        targetType: target.data_type,
        sourceCol:  sourceCol.column_name,
        sourceType: sourceCol.data_type,
        matchType,
        needsCast,
        selectExpr: `${castExpr} AS "${target.column_name}"`,
        status: 'mapped',
      });
    } else {
      const isNotNull = target.is_nullable === 'NO';
      const autoFillExpr = AUTO_FILL_EXPRESSIONS[targetName];

      if (autoFillExpr) {
        autofillColumns.push(target.column_name);
        mapping.push({
          targetCol:  target.column_name,
          targetType: target.data_type,
          sourceCol:  null,
          matchType:  'none',
          needsCast:  false,
          selectExpr: `${autoFillExpr} AS "${target.column_name}"`,
          status:     'autofill',
        });
      } else {
        if (isNotNull && !autoFillExpr) {
          console.warn(
            `[autoMapColumns] Column "${target.column_name}" is NOT NULL but has no ` +
            `shapefile match and no AUTO_FILL_EXPRESSIONS entry. ` +
            `Insert will likely fail — add an entry to AUTO_FILL_EXPRESSIONS to fix this.`,
          );
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

  // Track what shapefile cols are being ignored
  const usedSourceCols = new Set(mapping.map((m) => m.sourceCol).filter(Boolean));
  for (const src of sourceColumns) {
    if (!usedSourceCols.has(src.column_name)) {
      ignoredColumns.push(src.column_name);
    }
  }

  return { mapping, nulledColumns, autofillColumns, ignoredColumns };
}


async function getMaxObjectId(schema, table) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(objectid), 0) AS max_oid
       FROM "${schema}"."${table}"`,
    );
    return Number(rows[0]?.max_oid || 0);
  } catch (_) {
    return 0;
  }
}

async function migrateTempToSde(tempSchema, tempTable, sdeSchema, sdeTable, isNew) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sourceGeomCol = await getGeometryColumn(tempSchema, tempTable);
    const targetGeomCol = isNew ? 'geom' : await getGeometryColumn(sdeSchema, sdeTable);

    let mapping, nulledColumns, autofillColumns, ignoredColumns;

    if (isNew) {
      // New table — take all source columns as-is, no mapping needed
      const sourceColumns = await getTableColumns(tempSchema, tempTable);
      mapping = sourceColumns.map((col) => ({
        targetCol:  col.column_name,
        targetType: col.data_type,
        sourceCol:  col.column_name,
        sourceType: col.data_type,
        matchType:  'exact',
        needsCast:  false,
        selectExpr: `"${col.column_name}"`,
        status: 'mapped',
      }));
      nulledColumns = [];
      autofillColumns = [];
      ignoredColumns = [];
    } else {
      // Existing table — auto map source → target
      const sourceColumns = await getTableColumns(tempSchema, tempTable);
      const targetColumns = await getTableColumns(sdeSchema, sdeTable);
      ({ mapping, nulledColumns, autofillColumns, ignoredColumns } = autoMapColumns(sourceColumns, targetColumns));
    }

    // ── Logging ────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Migration: ${tempSchema}.${tempTable} → ${sdeSchema}.${sdeTable}`);
    console.log(`Mode: ${isNew ? 'CREATE NEW TABLE' : 'APPEND TO EXISTING'}`);
    console.log(`─${'─'.repeat(59)}`);
    console.log(`Mapped    (${mapping.filter(m => m.status === 'mapped').length}): ${mapping.filter(m => m.status === 'mapped').map(m => `${m.sourceCol}→${m.targetCol}${m.needsCast ? `(cast ${m.sourceType}→${m.targetType})` : ''}`).join(', ')}`);
    if (autofillColumns && autofillColumns.length) console.log(`AutoFill  (${autofillColumns.length}): ${autofillColumns.join(', ')}`);
    if (nulledColumns.length)                      console.log(`NULL      (${nulledColumns.length}): ${nulledColumns.join(', ')}`);
    if (ignoredColumns.length)                     console.log(`Ignored   (${ignoredColumns.length}): ${ignoredColumns.join(', ')}`);
    console.log(`${'═'.repeat(60)}\n`);
    // ───────────────────────────────────────────────────────────────

    const insertColumns = [];
    const selectExpressions = [];

    if (!isNew) {
      // objectid — safely continue from max existing value
      const maxOid = await getMaxObjectId(sdeSchema, sdeTable);

      const { rows: gidCheck } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = 'gid'`,
        [tempSchema, tempTable],
      );
      const orderByCol = gidCheck.length ? '"gid"' : 'ctid';

      insertColumns.push('objectid');
      selectExpressions.push(
        `${maxOid} + ROW_NUMBER() OVER (ORDER BY ${orderByCol}) AS objectid`,
      );
    }

    // All mapped / autofill / null columns
    for (const m of mapping) {
      insertColumns.push(`"${m.targetCol}"`);
      selectExpressions.push(m.selectExpr);
    }

    // Geometry — always transform to EPSG:4326
    insertColumns.push(`"${targetGeomCol}"`);
    selectExpressions.push(
      `ST_SetSRID(ST_Transform("${sourceGeomCol}"::geometry, 4326), 4326) AS "${targetGeomCol}"`,
    );

    console.log(`[Geometry] source:"${sourceGeomCol}" → target:"${targetGeomCol}"`);

    let query;

    if (isNew) {
      query = `
        CREATE TABLE "${sdeSchema}"."${sdeTable}" AS
        SELECT
          ROW_NUMBER() OVER (ORDER BY "${sourceGeomCol}" IS NULL, gid) AS objectid,
          ${selectExpressions.join(',\n          ')}
        FROM "${tempSchema}"."${tempTable}"
        WHERE "${sourceGeomCol}" IS NOT NULL
      `;

      await client.query(query);

      await client.query(
        `CREATE INDEX IF NOT EXISTS "${sdeTable}_geom_idx"
         ON "${sdeSchema}"."${sdeTable}" USING GIST ("${targetGeomCol}")`,
      );

      await client.query(
        `SELECT UpdateGeometrySRID('${sdeSchema}', '${sdeTable}', '${targetGeomCol}', 4326)`,
      );

    } else {
      query = `
        INSERT INTO "${sdeSchema}"."${sdeTable}" (
          ${insertColumns.join(',\n          ')}
        )
        SELECT
          ${selectExpressions.join(',\n          ')}
        FROM "${tempSchema}"."${tempTable}"
        WHERE "${sourceGeomCol}" IS NOT NULL
      `;

      await client.query(query);
    }

    await client.query('COMMIT');

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM "${sdeSchema}"."${sdeTable}"`,
    );

    return {
      success: true,
      totalRows: Number(countRows[0]?.count || 0),
      mapping,
      nulledColumns,
      autofillColumns: autofillColumns || [],
      ignoredColumns,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// ENSURE STANDARD COLUMNS ON FINAL TABLE
// ─────────────────────────────────────────────

async function ensureStandardColumns(schema, table) {
  await pool.query(
    `ALTER TABLE "${schema}"."${table}" ADD COLUMN IF NOT EXISTS attachment_bundle_url text`,
  );

  const geomCol = await getGeometryColumn(schema, table);
  if (geomCol) {
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "${table}_geom_gist"
       ON "${schema}"."${table}" USING GIST ("${geomCol}")`,
    );
  }
}

// ─────────────────────────────────────────────
// LOAD SHAPEFILE INTO TEMP TABLE (public schema)
// ─────────────────────────────────────────────

async function loadShapefileIntoTemp(shpPath, tempTable, env) {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = {
    DB_HOST: config.POSTGRES.DB_HOST,
    DB_PORT: config.POSTGRES.DB_PORT,
    DB_NAME: config.POSTGRES.DB_NAME,
    DB_USER: config.POSTGRES.USERNAME,
    DB_PASSWORD: config.POSTGRES.PASSWORD,
  };

  const cmd =
    `${SHP2PGSQL} -d -s 4326 -g "geom" "${shpPath}" public."${tempTable}" | ` +
    `${PSQL} -h ${DB_HOST} -p ${DB_PORT} -d ${DB_NAME} -U ${DB_USER}`;

  const { stderr } = await execAsync(cmd, {
    env: { ...env, PGPASSWORD: DB_PASSWORD },
    maxBuffer: 20 * 1024 * 1024,
  });

  if (stderr) console.log('shp2pgsql warnings:', stderr);
}

// ─────────────────────────────────────────────
// DROP TEMP TABLE
// ─────────────────────────────────────────────

async function dropTempTable(tempTable) {
  try {
    await pool.query(`DROP TABLE IF EXISTS public."${tempTable}"`);
    console.log(`Dropped temp table: public.${tempTable}`);
  } catch (err) {
    console.warn('Could not drop temp table:', err.message);
  }
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────

async function importShapefileToPostGIS(files, uploadId, layerNameFromRequest) {
  const fallbackLayerName = `layer_${uploadId.replace(/-/g, '').slice(0, 12)}`;
  const requestedLayerName = sanitizeLayerName(layerNameFromRequest, fallbackLayerName);

  const target = await resolveTargetTable(requestedLayerName);

  validateShapefileBundle(files);
  const { workDir, shpPath } = makeWorkingCopies(files, uploadId);

  if (!fs.existsSync(shpPath)) {
    removeDirSafe(workDir);
    throw new Error(`Shapefile working copy not found: ${shpPath}`);
  }

  const tempTable = `_temp_${sanitizeLayerName(requestedLayerName, 'layer')}_${uploadId.replace(/-/g, '').slice(0, 8)}`;

  const env = { ...process.env };

  try {
    console.log(`Loading shapefile into temp table: public.${tempTable}`);
    await loadShapefileIntoTemp(shpPath, tempTable, env);

    console.log(`Migrating public.${tempTable} → ${target.table_schema}.${target.table_name}`);
    const migrationResult = await migrateTempToSde(
      'public',
      tempTable,
      target.table_schema,
      target.table_name,
      !target.exists,
    );

    await ensureStandardColumns(target.table_schema, target.table_name);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM "${target.table_schema}"."${target.table_name}"`,
    );
    const totalRows = Number(countRows[0]?.count || 0);

    console.log(`✅ Done. Total rows in ${target.table_schema}.${target.table_name}: ${totalRows}`);

    return {
      layerName:      target.table_name,
      targetSchema:   target.table_schema,
      targetTable:    target.table_name,
      geometryColumn: await getGeometryColumn(target.table_schema, target.table_name),
      featureCount:   totalRows,
      mapping: {
        mapped:   migrationResult.mapping.filter(m => m.status === 'mapped').length,
        autofill: migrationResult.autofillColumns || [],
        nulled:   migrationResult.nulledColumns,
        ignored:  migrationResult.ignoredColumns,
      },
    };

  } finally {
    removeDirSafe(workDir);
    await dropTempTable(tempTable);
  }
}

module.exports = { importShapefileToPostGIS };
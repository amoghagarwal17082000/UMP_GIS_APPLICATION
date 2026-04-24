const pool = require('../../../../config/postgres');

const TABLE_NAME_ALIASES = {
  station: 'station',
  km_post: 'km_post',
  india_railway_track: 'india_railway_track',
  railway_track: 'india_railway_track',
  land_plan_on_track: 'land_plan_on_track',
  land_plan_offtrack: 'land_plan_offtrack',
  land_boundary: 'land_boundary',
  land_offset: 'land_offset',
  road_over_bridge: 'road_over_bridge',
  foot_over_bridge: 'foot_over_bridge',
  point_xing: 'point_xing',
  switch_expansion_joint: 'switch_expansion_joint_1',
  sej: 'switch_expansion_joint_1',
  levelxing: 'levelxing',
  rub_lhs: 'rub_lhs',
  yard_line: 'yard_line',
  bridge_end: 'bridge_end',
  bridge_minor: 'bridge_minor',
  bridge_start: 'bridge_start',
};

function normalizeLayerKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

async function getAvailableTables() {
  const sql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'sde'
  `;
  const { rows } = await pool.query(sql);
  return new Set(rows.map((row) => String(row.table_name || '').trim().toLowerCase()).filter(Boolean));
}

async function hasDivisionColumn(tableName) {
  const sql = `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'sde'
        AND table_name = $1
        AND column_name = 'division'
    ) AS exists
  `;
  const { rows } = await pool.query(sql, [tableName]);
  return !!rows[0]?.exists;
}

async function getTableColumns(tableName) {
  const sql = `
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'sde'
      AND table_name = $1
    ORDER BY ordinal_position
  `;
  const { rows } = await pool.query(sql, [tableName]);
  return rows.map((row) => ({
    columnName: String(row.column_name || '').trim(),
    dataType: String(row.data_type || '').trim().toLowerCase(),
    udtName: String(row.udt_name || '').trim().toLowerCase(),
  }));
}

function pickFirstMatchingColumn(columns, candidates) {
  for (const candidate of candidates) {
    const match = columns.find((column) => column.columnName.toLowerCase() === candidate);
    if (match) return match.columnName;
  }
  return null;
}

function resolveGeometryColumn(columns) {
  const preferred = pickFirstMatchingColumn(columns, ['shape', 'geom', 'geometry', 'wkb_geometry']);
  if (preferred) return preferred;
  const typedGeometry = columns.find((column) => column.udtName === 'geometry');
  return typedGeometry?.columnName || null;
}

function resolveIdColumn(columns) {
  return pickFirstMatchingColumn(columns, ['objectid', 'gid', 'id']) || 'objectid';
}

function resolveTableName(layerName, availableTables) {
  const normalized = normalizeLayerKey(layerName);
  const candidates = [
    TABLE_NAME_ALIASES[normalized],
    normalized,
    normalized.replace(/_label$/, ''),
    normalized.replace(/_point_label$/, ''),
    normalized.replace(/_point$/, ''),
  ].filter(Boolean);

  const match = candidates.find((candidate) => availableTables.has(String(candidate).toLowerCase()));
  return match || null;
}

async function getDepartmentLayerCatalog(departmentRef) {
  const availableTables = await getAvailableTables();
  const sql = `
    SELECT objectid, layar_name, department, department_id
    FROM sde.department_table
    WHERE CAST(department_id AS text) = CAST($1 AS text)
       OR LOWER(COALESCE(department, '')) = LOWER(CAST($1 AS text))
    ORDER BY objectid
  `;

  const { rows } = await pool.query(sql, [departmentRef]);
  const layers = rows
    .map((row) => {
      const layerName = String(row.layar_name || '').trim();
      const layerKey = normalizeLayerKey(layerName);
      const tableName = resolveTableName(layerName, availableTables);

      return {
        objectid: row.objectid,
        layerName,
        layerKey,
        department: row.department,
        departmentId: String(row.department_id || '').trim(),
        tableName,
        available: !!tableName,
      };
    })
    .filter((layer) => layer.available);

  return layers;
}

async function resolveDepartmentLayerConfig(departmentRef, layerKey) {
  const catalog = await getDepartmentLayerCatalog(departmentRef);
  const match = catalog.find((layer) => layer.layerKey === normalizeLayerKey(layerKey));

  if (!match?.tableName) {
    const err = new Error('Department layer not found');
    err.status = 404;
    throw err;
  }

  const columns = await getTableColumns(match.tableName);
  const geometryColumn = resolveGeometryColumn(columns);
  if (!geometryColumn) {
    const err = new Error(`No geometry column found for layer "${match.layerName}"`);
    err.status = 500;
    throw err;
  }

  return {
    meta: match,
    layerConfig: {
      table: `sde.${match.tableName}`,
      idColumn: resolveIdColumn(columns),
      geometryColumn,
      hasDivision: await hasDivisionColumn(match.tableName),
    },
  };
}

async function getLayerGeoJSON(layerConfig, whereSql, params, division) {
  let divisionSql = '';

  if (division && layerConfig.hasDivision !== false) {
    params.push(division);
    divisionSql = ` AND UPPER(division) = UPPER($${params.length})`;
  }

  const sql = `
    SELECT jsonb_build_object(
      'type','FeatureCollection',
      'features', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'type','Feature',
            'id', ${layerConfig.idColumn},
            'properties', to_jsonb(t) - '${layerConfig.geometryColumn}',
            'geometry', ST_AsGeoJSON(${layerConfig.geometryColumn})::jsonb
          )
        ),
        '[]'::jsonb
      )
    ) AS geojson
    FROM (
      SELECT *
      FROM ${layerConfig.table}
      WHERE ${whereSql} ${divisionSql}
      LIMIT 20000
    ) t;
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0]?.geojson;
}

async function getDepartmentLayerGeoJSON(departmentRef, layerKey, whereSql, params, division) {
  const { meta, layerConfig } = await resolveDepartmentLayerConfig(departmentRef, layerKey);
  const geojson = await getLayerGeoJSON(layerConfig, whereSql, params, division);
  return {
    geojson,
    meta,
  };
}

module.exports = {
  getLayerGeoJSON,
  getDepartmentLayerCatalog,
  getDepartmentLayerGeoJSON,
  resolveDepartmentLayerConfig,
  normalizeLayerKey,
};


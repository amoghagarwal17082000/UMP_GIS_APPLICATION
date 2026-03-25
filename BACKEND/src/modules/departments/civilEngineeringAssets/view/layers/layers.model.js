const pool = require('../../../../../config/postgres');

async function getLayerGeoJSON(layerConfig, whereSql, params, division) {
  let divisionSql = '';

  if (division) {
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

module.exports = { getLayerGeoJSON };


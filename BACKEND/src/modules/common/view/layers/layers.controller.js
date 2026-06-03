const config = require('./layers.config');
const model = require('./layers.model');
const parseBbox = require('../../../../utils/parseBbox');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

function getRailwayTrackSimplifyTolerance(z) {
  const zoom = Number(z);

  if (!Number.isFinite(zoom)) return 0;
  if (zoom < 6) return 0.03;
  if (zoom < 8) return 0.01;
  if (zoom < 10) return 0.003;

  return 0;
}

async function getDepartmentLayers(req, res, next) {
  try {
    const departmentRef = String(req.params.departmentRef || req.query.department || '').trim();
    if (!departmentRef) {
      const err = new Error('Department is required');
      err.status = 400;
      throw err;
    }

    const layers = await model.getDepartmentLayerCatalog(departmentRef);
    res.json({ success: true, data: layers });
  } catch (err) {
    next(err);
  }
}

async function getDepartmentLayer(req, res, next) {
  try {
    const departmentRef = String(req.params.departmentRef || '').trim();
    const layerKey = String(req.params.layerKey || '').trim();
    const { bbox, division, limit, allIndia } = req.query;
    const useAllIndia = isTruthy(allIndia);

    if (!departmentRef || !layerKey) {
      const err = new Error('Department and layer are required');
      err.status = 400;
      throw err;
    }

    const effectiveDivision = useAllIndia ? '' : String(division || req?.user?.division || '').trim();
    const { meta, layerConfig } = await model.resolveDepartmentLayerConfig(departmentRef, layerKey);
    const { where, params } = parseBbox(bbox, layerConfig.geometryColumn);
    const geojson = await model.getLayerGeoJSON(layerConfig, where, params, effectiveDivision, limit);

    res.json(geojson || { type: 'FeatureCollection', features: [], meta });
  } catch (err) {
    next(err);
  }
}

async function getLayer(req, res, next) {
  try {
    const { layer } = req.params;
    const { bbox, division, limit, allIndia, z, categories } = req.query;
    const useAllIndia = isTruthy(allIndia);

    const effectiveDivision = useAllIndia ? '' : String(division || req?.user?.division || '').trim();
    const baseLayerConfig = config[layer];

    if (!baseLayerConfig) {
      const err = new Error('Invalid layer name');
      err.status = 404;
      throw err;
    }

    const layerConfig = useAllIndia && baseLayerConfig.allIndiaTable
      ? {
        ...baseLayerConfig,
        table: baseLayerConfig.allIndiaTable,
        hasDivision: false,
      }
      : baseLayerConfig;

    const { where, params } = parseBbox(bbox, layerConfig.geometryColumn);

    const simplifyTolerance =
      layer === 'railwayTrack' ? getRailwayTrackSimplifyTolerance(z) : 0;


    const categoryList =
      layer === 'station'
        ? String(categories || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        : [];

    const geojson = await model.getLayerGeoJSON(
      layerConfig,
      where,
      params,
      effectiveDivision,
      limit,
      simplifyTolerance,
      categoryList
    );

    res.json(
      geojson || { type: 'FeatureCollection', features: [] }
    );
  } catch (err) {
    next(err);
  }
}

async function searchStations(req, res, next) {
  try {
    const { division, allIndia } = req.query;
    const useAllIndia = isTruthy(allIndia);
    const q = String(req.query.q || '').trim();
    const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 10));
    const effectiveDivision = useAllIndia ? '' : String(division || req?.user?.division || '').trim();

    if (!q || q.length < 2) {
      return res.json({ type: 'FeatureCollection', features: [] });
    }

    const geojson = await model.searchStations(q, limit, effectiveDivision);

    res.json(geojson || { type: 'FeatureCollection', features: [] });
  } catch (err) {
    next(err);
  }
}


module.exports = {
  getLayer,
  getDepartmentLayers,
  getDepartmentLayer,
  searchStations,
};

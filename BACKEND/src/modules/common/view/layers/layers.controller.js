const config = require('./layers.config');
const model = require('./layers.model');
const parseBbox = require('../../../../utils/parseBbox');

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
    const { bbox, division } = req.query;

    if (!departmentRef || !layerKey) {
      const err = new Error('Department and layer are required');
      err.status = 400;
      throw err;
    }

    const effectiveDivision = String(division || req?.user?.division || '').trim();
    const { where, params } = parseBbox(bbox);
    const { geojson, meta } = await model.getDepartmentLayerGeoJSON(
      departmentRef,
      layerKey,
      where,
      params,
      effectiveDivision
    );

    res.json(geojson || { type: 'FeatureCollection', features: [], meta });
  } catch (err) {
    next(err);
  }
}

async function getLayer(req, res, next) {
  try {
    const { layer } = req.params;
    const { bbox, division } = req.query;

    const effectiveDivision = String(division || req?.user?.division || '').trim();
    const layerConfig = config[layer];

    if (!layerConfig) {
      const err = new Error('Invalid layer name');
      err.status = 404;
      throw err;
    }

    const { where, params } = parseBbox(bbox);

    const geojson = await model.getLayerGeoJSON(
      layerConfig,
      where,
      params,
      effectiveDivision
    );

    res.json(
      geojson || { type: 'FeatureCollection', features: [] }
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLayer,
  getDepartmentLayers,
  getDepartmentLayer,
};

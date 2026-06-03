const config = require('./layers.config');
const model = require('./layers.model');
const parseBbox = require('../../../../../utils/parseBbox');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

async function getLayer(req, res, next) {
  try {
    const { layer } = req.params;
    const { bbox, division, allIndia } = req.query;
    const useAllIndia = isTruthy(allIndia);

    const effectiveDivision = useAllIndia ? '' : String(division || req?.user?.division || '').trim();
    const layerConfig = config[layer];

    if (!layerConfig) {
      const err = new Error('Invalid CEA layer');
      err.status = 404;
      throw err;
    }

    let where;
    let params;

    if (layerConfig.ignoreBbox) {
      where = layerConfig.customWhere || '1=1';
      params = [];
    } else {
      const parsed = parseBbox(bbox);
      where = parsed.where;
      params = parsed.params;
    }

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

async function getCurrentDivisionBuffer(req, res, next) {
  try {
    const { division, allIndia } = req.query;
    const useAllIndia = isTruthy(allIndia);
    if (useAllIndia) {
      return res.json({ type: 'FeatureCollection', features: [] });
    }
    const effectiveDivision = useAllIndia ? '' : String(division || req?.user?.division || '').trim();
    const geojson = await model.getDivisionBufferGeoJSON(effectiveDivision);

    res.json(
      geojson || { type: 'FeatureCollection', features: [] }
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { getLayer, getCurrentDivisionBuffer };

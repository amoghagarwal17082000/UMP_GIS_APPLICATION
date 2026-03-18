const config = require('./layers.config');
const model = require('./layers.model');
const parseBbox = require('../../../../utils/parseBbox');

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
  getLayer
};

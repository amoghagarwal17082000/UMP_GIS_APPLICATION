const config = require('./layers.config');
const model = require('./layers.model');
const parseBbox = require('../../../../utils/parseBbox');
const { getSessionUserId } = require('../../../auth/auth.session');
const authModel = require('../../../auth/auth.model');

async function getLayer(req, res, next) {
  try {
    const { layer } = req.params;
    const { bbox, division } = req.query;

    let effectiveDivision = division?.trim();
    if (!effectiveDivision) {
      const sessionUserId = getSessionUserId(req);
      if (sessionUserId) {
        const sessionUser = await authModel.findUserById(sessionUserId);
        effectiveDivision = sessionUser?.division_code?.trim?.() || '';
      }
    }

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

// src/modules/departments/civilEngineeringAssets/view/layers/layers.controller.js

const config = require('./layers.config');
const model = require('./layers.model');
const parseBbox = require('../../../../../utils/parseBbox');
const { getSessionUserId } = require('../../../../auth/auth.session');
const authModel = require('../../../../auth/auth.model');

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

module.exports = { getLayer };

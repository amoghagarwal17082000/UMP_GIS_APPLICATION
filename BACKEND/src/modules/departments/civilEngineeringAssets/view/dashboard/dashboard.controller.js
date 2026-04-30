// src/modules/departments/civilEngineeringAssets/view/dashboard/dashboard.controller.js

const config = require('./dashboard.config');
const model = require('./dashboard.model');

async function getAssetCount(req, res, next) {
  try {
    const { asset } = req.params;
    const { division, type = 'TOTAL' } = req.query;

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const tableName = config[asset];

    if (!tableName) {
      const err = new Error('Invalid dashboard asset');
      err.status = 404;
      throw err;
    }

    const count = await model.getCount(
      tableName,
      division.trim(),
      String(type).toUpperCase()
    );

    res.json({ count });

  } catch (err) {
    next(err);
  }
}

module.exports = { getAssetCount };

// src/modules/departments/civilEngineeringAssets/view/dashboard/dashboard.controller.js

const config = require('./dashboard.config');
const model = require('./dashboard.model');

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isSuperAdmin(req) {
  return normalizeText(req?.user?.user_type) === 'super admin';
}

async function getAssetCount(req, res, next) {
  try {
    const { asset } = req.params;
    const { division, zone, type = 'TOTAL', allIndia } = req.query;
    const wantsAllIndia = String(allIndia || '').trim().toLowerCase() === 'true';

    if (wantsAllIndia && !isSuperAdmin(req)) {
      const err = new Error('Only Super Admin can view all-India dashboard counts');
      err.status = 403;
      throw err;
    }

    if (!wantsAllIndia && !division) {
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
      {
        division: String(division || '').trim(),
        zone: String(zone || '').trim(),
      },
      String(type).toUpperCase(),
      wantsAllIndia
    );

    res.json({ count });

  } catch (err) {
    next(err);
  }
}

async function getZoneDivisionFilters(req, res, next) {
  try {
    const data = await model.getZoneDivisionFilters(config.station);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAssetCount, getZoneDivisionFilters };

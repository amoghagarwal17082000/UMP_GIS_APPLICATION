const configMap = require('./edit.config');
const model = require('./edit.model');

function resolveConfig(layer) {
  const config = configMap[layer];
  if (!config) {
    const err = new Error('Invalid edit layer');
    err.status = 404;
    throw err;
  }
  return config;
}

async function getById(req, res, next) {
  try {
    const { layer, id } = req.params;
    const division = String(req.query.division || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const row = await model.getById(config, Number(id), division);

    if (!row) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.json(row);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { layer } = req.params;
    const division = String(req.query.division || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const row = await model.create(config, req.body, division);

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { layer, id } = req.params;
    const division = String(req.query.division || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const row = await model.update(config, Number(id), division, req.body);

    if (!row) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.json(row);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { layer, id } = req.params;
    const division = String(req.query.division || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const deleted = await model.remove(config, Number(id), division);

    if (!deleted) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getTable(req, res, next) {
  try {
    const { layer } = req.params;
    const { page = 1, pageSize = 10, q = '' } = req.query;
    const division = String(req.query.division || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const result = await model.getTable(config, page, pageSize, q, division);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function validateStation(req, res, next) {
  try {
    const config = resolveConfig('station');
    const stationCode = String(req.body?.station_code || '').trim();

    if (!stationCode) {
      const err = new Error('station_code is required');
      err.status = 400;
      throw err;
    }

    const row = await model.validateStation(config, stationCode);

    if (!row) {
      const err = new Error('Station code not found in validation table');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: 'Station code validated successfully',
      row,
    });
  } catch (err) {
    next(err);
  }
}

async function sendStationEdit(req, res, next) {
  try {
    const config = resolveConfig('station');
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const division = String(req.query.division || '').trim();
    const { id } = req.params;

    if (!makerUserId) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const result = await model.sendStationEdit(config, Number(id), division, req.body || {}, makerUserId);

    if (!result) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.status(201).json({
      success: true,
      message: 'Station edit sent to checker',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getById,
  create,
  update,
  remove,
  getTable,
  validateStation,
  sendStationEdit,
};

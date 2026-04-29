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

async function getDraftById(req, res, next) {
  try {
    const { layer, id } = req.params;
    const division = String(req.query.division || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const row = await model.getDraftById(config, Number(id), division);

    if (!row) {
      const err = new Error('Draft record not found');
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

async function getDraftTable(req, res, next) {
  try {
    const { layer } = req.params;
    const { page = 1, pageSize = 10, q = '', status = '' } = req.query;
    const division = String(req.query.division || '').trim();
    const actingUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const actingUserType = String(req?.user?.user_type || '').trim();

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const config = resolveConfig(layer);
    const result = await model.getDraftTable(
      config,
      page,
      pageSize,
      q,
      division,
      String(status || '').trim(),
      actingUserId,
      actingUserType
    );
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

async function validateAssetId(req, res, next) {
  try {
    const { layer } = req.params;
    const division = String(req.query.division || '').trim();
    const assetId = String(req.body?.asset_id || '').trim();
    const objectId = Number(req.body?.objectid);

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    if (!assetId) {
      const err = new Error('asset_id is required');
      err.status = 400;
      throw err;
    }

    const config = configMap[layer] || null;
    const row = await model.validateAssetId(
      config,
      layer,
      division,
      assetId,
      Number.isFinite(objectId) ? objectId : null
    );

    res.json({
      success: true,
      message: 'Asset ID validated successfully',
      row,
    });
  } catch (err) {
    next(err);
  }
}

async function sendNewStationEdit(req, res, next) {
  try {
    const config = resolveConfig('station');
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();

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

    const result = await model.sendNewStationEdit(config, division, req.body || {}, makerUserId, submittingUserType);

    res.status(201).json({
      success: true,
      message: 'New station sent to checker',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}
async function sendStationEdit(req, res, next) {
  try {
    const config = resolveConfig('station');
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid station id');
      err.status = 400;
      throw err;
    }

    const result = await model.sendStationEdit(config, numericId, division, req.body || {}, makerUserId, submittingUserType);

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

async function updateStationDraftStatus(req, res, next) {
  try {
    const config = resolveConfig('station');
    const actingUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const actingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();
    const { id } = req.params;
    const nextStatus = String(req.body?.status || '').trim();

    if (!actingUserId) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid draft id');
      err.status = 400;
      throw err;
    }

    const result = await model.updateStationDraftStatus(
      config,
      numericId,
      division,
      nextStatus,
      actingUserId,
      actingUserType
    );

    if (!result?.draft) {
      const err = new Error('Draft record not found');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: `Station draft status updated to ${nextStatus}`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function requestStationDeletion(req, res, next) {
  try {
    const config = resolveConfig('station');
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid station id');
      err.status = 400;
      throw err;
    }

    const result = await model.requestStationDeletion(
      config,
      numericId,
      division,
      makerUserId,
      submittingUserType
    );

    if (!result?.draft) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.status(201).json({
      success: true,
      message: 'Station sent to checker for deletion',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function requestStationDraftDeletion(req, res, next) {
  try {
    const config = resolveConfig('station');
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid draft id');
      err.status = 400;
      throw err;
    }

    const result = await model.requestStationDraftDeletion(
      config,
      numericId,
      division,
      makerUserId,
      submittingUserType
    );

    if (!result?.draft) {
      const err = new Error('Draft record not found');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: 'Station sent to checker for deletion',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function resendStationDraft(req, res, next) {
  try {
    const config = resolveConfig('station');
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid draft id');
      err.status = 400;
      throw err;
    }

    const result = await model.resendStationDraft(config, numericId, division, req.body || {}, makerUserId, submittingUserType);

    if (!result?.draft) {
      const err = new Error('Draft record not found');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: 'Station draft sent to checker',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function sendNewLayerEdit(req, res, next) {
  try {
    const { layer } = req.params;
    const config = resolveConfig(layer);
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();

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

    const result = await model.sendNewStationEdit(config, division, req.body || {}, makerUserId, submittingUserType);

    res.status(201).json({
      success: true,
      message: `${layer} sent to checker`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function sendLayerEdit(req, res, next) {
  try {
    const { layer, id } = req.params;
    const config = resolveConfig(layer);
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();

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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error(`Invalid ${layer} id`);
      err.status = 400;
      throw err;
    }

    const result = await model.sendStationEdit(config, numericId, division, req.body || {}, makerUserId, submittingUserType);
    if (!result) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.status(201).json({
      success: true,
      message: `${layer} edit sent to checker`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function updateLayerDraftStatus(req, res, next) {
  try {
    const { layer, id } = req.params;
    const config = resolveConfig(layer);
    const actingUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const actingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();
    const nextStatus = String(req.body?.status || '').trim();

    if (!actingUserId) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }

    if (!division) {
      const err = new Error('division is required');
      err.status = 400;
      throw err;
    }

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid draft id');
      err.status = 400;
      throw err;
    }

    const result = await model.updateStationDraftStatus(config, numericId, division, nextStatus, actingUserId, actingUserType);
    if (!result?.draft) {
      const err = new Error('Draft record not found');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: `${layer} draft status updated to ${nextStatus}`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function requestLayerDeletion(req, res, next) {
  try {
    const { layer, id } = req.params;
    const config = resolveConfig(layer);
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();

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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error(`Invalid ${layer} id`);
      err.status = 400;
      throw err;
    }

    const result = await model.requestStationDeletion(config, numericId, division, makerUserId, submittingUserType);
    if (!result?.draft) {
      const err = new Error('Record not found');
      err.status = 404;
      throw err;
    }

    res.status(201).json({
      success: true,
      message: `${layer} sent to checker for deletion`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function requestLayerDraftDeletion(req, res, next) {
  try {
    const { layer, id } = req.params;
    const config = resolveConfig(layer);
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();

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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid draft id');
      err.status = 400;
      throw err;
    }

    const result = await model.requestStationDraftDeletion(config, numericId, division, makerUserId, submittingUserType);
    if (!result?.draft) {
      const err = new Error('Draft record not found');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: `${layer} sent to checker for deletion`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function resendLayerDraft(req, res, next) {
  try {
    const { layer, id } = req.params;
    const config = resolveConfig(layer);
    const makerUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const submittingUserType = String(req?.user?.user_type || '').trim();
    const division = String(req.query.division || '').trim();

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

    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      const err = new Error('Invalid draft id');
      err.status = 400;
      throw err;
    }

    const result = await model.resendStationDraft(config, numericId, division, req.body || {}, makerUserId, submittingUserType);
    if (!result?.draft) {
      const err = new Error('Draft record not found');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      message: `${layer} draft sent to checker`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getById,
  getDraftById,
  create,
  update,
  remove,
  getTable,
  getDraftTable,
  validateStation,
  validateAssetId,
  sendStationEdit,
  sendNewStationEdit,
  updateStationDraftStatus,
  requestStationDeletion,
  requestStationDraftDeletion,
  resendStationDraft,
  sendLayerEdit,
  sendNewLayerEdit,
  updateLayerDraftStatus,
  requestLayerDeletion,
  requestLayerDraftDeletion,
  resendLayerDraft,
};



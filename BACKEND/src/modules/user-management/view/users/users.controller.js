const userModel = require('./users.model');

async function getUsers(req, res, next) {

  try {

    const { division } = req.query;

    const users = await userModel.getUsersByDivision(division);

    res.json(users);

  } catch (err) {

    next(err);

  }

}

/* =====================================
   GET MAKER + CHECKER DROPDOWN LIST
===================================== */

async function getMakerCheckerList(req, res, next) {

  try {

    const { division } = req.query;

    const data = await userModel.getMakerCheckerList(division);

    res.json(data);

  } catch (err) {

    next(err);

  }

}



/* =====================================
   ASSIGN CHECKER TO MAKER
===================================== */

async function assignChecker(req, res, next) {

  try {

    const { maker_id, checker_id } = req.body;

    await userModel.assignChecker(maker_id, checker_id);

    res.json({
      success: true,
      message: "Checker assigned successfully"
    });

  } catch (err) {

    next(err);

  }

}


async function getAssignedCheckerUsers(req, res, next) {
  try {
    const { division } = req.query;
    const users = await userModel.getAssignedCheckerUsers(division);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function unassignChecker(req, res, next) {
  try {
    const { maker_id } = req.body;

    await userModel.unassignChecker(maker_id);

    res.json({
      success: true,
      message: 'Checker unassigned successfully'
    });
  } catch (err) {
    next(err);
  }
}

async function updateUserDetails(req, res, next) {
  try {
    const { objectid, user_name, password } = req.body || {};

    if (!objectid || !user_name || !password) {
      return res.status(400).json({
        success: false,
        message: 'objectid, user_name and password are required'
      });
    }

    const updatedUser = await userModel.updateUserDetails(objectid, user_name, password);

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (err) {
    next(err);
  }
}

async function getMakerLayerList(req, res, next) {
  try {
    const { division, current_user_id } = req.query;
    const data = await userModel.getMakerLayerList(
      division,
      String(current_user_id || '').trim()
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function getLayersByDepartment(req, res, next) {
  try {
    const { department_id } = req.query;

    if (!department_id) {
      return res.status(400).json({
        success: false,
        message: 'department_id is required'
      });
    }

    const layers = await userModel.getLayersByDepartment(department_id);
    res.json(layers);
  } catch (err) {
    next(err);
  }
}

async function assignLayersToMaker(req, res, next) {
  try {
    const { maker_id, layer_ids } = req.body || {};

    if (!maker_id || !Array.isArray(layer_ids) || layer_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'maker_id and layer_ids are required'
      });
    }

    await userModel.assignLayersToMaker(maker_id, layer_ids);

    res.json({
      success: true,
      message: 'Layers assigned successfully'
    });
  } catch (err) {
    next(err);
  }
}

async function getAssignedLayerUsers(req, res, next) {
  try {
    const { division } = req.query;
    const users = await userModel.getAssignedLayerUsers(division);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function updateAssignedLayers(req, res, next) {
  try {
    const { maker_id, layer_ids } = req.body || {};

    if (!maker_id || !Array.isArray(layer_ids)) {
      return res.status(400).json({
        success: false,
        message: "maker_id and layer_ids are required",
      });
    }

    await userModel.updateAssignedLayers(maker_id, layer_ids);

    res.json({
      success: true,
      message: "Assigned layers updated successfully",
    });
  } catch (err) {
    next(err);
  }
}

async function clearAssignedLayers(req, res, next) {
  try {
    const { maker_id } = req.body || {};

    if (!maker_id) {
      return res.status(400).json({
        success: false,
        message: "maker_id is required",
      });
    }

    await userModel.clearAssignedLayers(maker_id);

    res.json({
      success: true,
      message: "Assigned layers cleared successfully",
    });
  } catch (err) {
    next(err);
  }
}






module.exports = {
  getUsers,
  getMakerCheckerList,
  assignChecker,
  getAssignedCheckerUsers,
  unassignChecker,
  updateUserDetails,
  getMakerLayerList,
  getLayersByDepartment,
  assignLayersToMaker,
  getAssignedLayerUsers,
  updateAssignedLayers,
  clearAssignedLayers,
};

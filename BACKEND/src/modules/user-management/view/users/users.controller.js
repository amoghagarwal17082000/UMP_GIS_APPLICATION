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

module.exports = {
  getUsers,
  getMakerCheckerList,
  assignChecker
};
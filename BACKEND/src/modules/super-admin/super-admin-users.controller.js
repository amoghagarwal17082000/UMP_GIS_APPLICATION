const superAdminUserModel = require("./super-admin-users.model");

async function getAllUsers(req, res, next) {
  try {
    const users = await superAdminUserModel.getAllUsers();
    res.json(users);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllUsers,
};

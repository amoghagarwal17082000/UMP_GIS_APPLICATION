const express = require("express");
const router = express.Router();
const controller = require("./super-admin-users.controller");

router.get("/", controller.getAllUsers);

module.exports = router;

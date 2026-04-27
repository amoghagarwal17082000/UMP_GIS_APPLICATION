const express = require('express');
const controller = require('./location.controller');

const router = express.Router();

router.get('/states', controller.getStates);
router.get('/districts', controller.getDistricts);
router.get('/parliamentary-constituencies', controller.getParliamentaryConstituencies);

module.exports = router;

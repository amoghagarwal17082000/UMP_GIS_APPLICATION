// src/modules/departments/civilEngineeringAssets/view/dashboard/dashboard.routes.js

const express = require('express');
const router = express.Router();
const controller = require('./dashboard.controller');

router.get('/filters/zone-division', controller.getZoneDivisionFilters);
router.get('/:asset/count', controller.getAssetCount);

module.exports = router;

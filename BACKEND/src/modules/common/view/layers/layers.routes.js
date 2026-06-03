const express = require('express');
const router = express.Router();
const controller = require('./layers.controller');

router.get('/department/:departmentRef/layers', controller.getDepartmentLayers);
router.get('/department/:departmentRef/layers/:layerKey', controller.getDepartmentLayer);
router.get('/station/search', controller.searchStations);
router.get('/:layer', controller.getLayer);

module.exports = router;

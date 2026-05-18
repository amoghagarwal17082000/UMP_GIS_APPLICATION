const express = require('express');
const router = express.Router();
const controller = require('./layers.controller');

router.get('/division-buffer/current', controller.getCurrentDivisionBuffer);
router.get('/:layer', controller.getLayer);

module.exports = router;

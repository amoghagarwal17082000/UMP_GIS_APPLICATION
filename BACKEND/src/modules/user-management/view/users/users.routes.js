const express = require('express');
const router = express.Router();
const controller = require('./users.controller');

router.get('/', controller.getUsers);
/* popup dropdown data */
router.get('/maker-checker-list', controller.getMakerCheckerList);
router.post('/assign-checker', controller.assignChecker);
router.get('/assigned-checkers', controller.getAssignedCheckerUsers);
router.post('/unassign-checker', controller.unassignChecker);



module.exports = router;
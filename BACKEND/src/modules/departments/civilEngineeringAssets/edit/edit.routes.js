const express = require('express');
const router = express.Router();
const controller = require('./edit.controller');

router.post('/station/validate', controller.validateStation);
router.post('/station/send-new', controller.sendNewStationEdit);
router.post('/station/:id/send', controller.sendStationEdit);
router.post('/station/:id/request-deletion', controller.requestStationDeletion);
router.post('/station/draft/:id/request-deletion', controller.requestStationDraftDeletion);
router.post('/station/draft/:id/resend', controller.resendStationDraft);
router.post('/station/draft/:id/status', controller.updateStationDraftStatus);
router.post('/:layer/send-new', controller.sendNewLayerEdit);
router.post('/:layer/:id/send', controller.sendLayerEdit);
router.post('/:layer/:id/request-deletion', controller.requestLayerDeletion);
router.post('/:layer/draft/:id/request-deletion', controller.requestLayerDraftDeletion);
router.post('/:layer/draft/:id/resend', controller.resendLayerDraft);
router.post('/:layer/draft/:id/status', controller.updateLayerDraftStatus);
router.get('/:layer/draft-table', controller.getDraftTable);
router.get('/:layer/draft/:id', controller.getDraftById);
router.get('/:layer/table', controller.getTable);
router.get('/:layer/:id', controller.getById);

router.post('/:layer', controller.create);
router.put('/:layer/:id', controller.update);
router.delete('/:layer/:id', controller.remove);

module.exports = router;



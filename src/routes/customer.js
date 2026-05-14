const express = require('express');
const { authenticate, hasModuleAccess, canManage } = require('../middlewares/authMiddleware');
const CustomerController = require('../controllers/CustomerController');
const verifyInternalRequest = require('../middlewares/verifyInternalRequest');
const router = express.Router();

// GET
router.get("/my-customers", authenticate, hasModuleAccess("crm"), CustomerController.getMyCustomers);
router.get("/agent-customers", verifyInternalRequest, CustomerController.getMyCustomersAsAgent);
router.get("/my-info", verifyInternalRequest, CustomerController.getMyInfo);
router.get("/all", authenticate, canManage("crm"), CustomerController.getAll);

// POST
router.post("/upsert", verifyInternalRequest, CustomerController.upsert);
router.post("/apply-referral", verifyInternalRequest, CustomerController.applyReferral);
router.post("/bulk-upsert", verifyInternalRequest, CustomerController.bulkUpsert);

module.exports = router;

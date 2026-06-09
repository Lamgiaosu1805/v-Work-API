const express = require('express');
const { authenticate, hasModuleAccess, canManage, isAdmin } = require('../middlewares/authMiddleware');
const CustomerController = require('../controllers/CustomerController');
const verifyInternalRequest = require('../middlewares/verifyInternalRequest');
const router = express.Router();

// GET
router.get("/my-customers", authenticate, hasModuleAccess("crm"), CustomerController.getMyCustomers);
router.get("/agent-customers", verifyInternalRequest, CustomerController.getMyCustomersAsAgent);
router.get("/my-info",authenticate, CustomerController.getMyInfo);
router.get("/all", authenticate, canManage("crm"), CustomerController.getAll);
router.get("/detail-info-customer", authenticate, canManage("crm"), CustomerController.getDetailInfo);
router.get("/fluctuation", authenticate, canManage("crm"), CustomerController.getFluctuation);
router.get("/view-image", authenticate, canManage("crm"), CustomerController.getViewImmage);
router.get("/investment-holding", authenticate, canManage("crm"), CustomerController.getCustomerInvestmentHolding);
router.get("/staff-info", authenticate, canManage("crm"), CustomerController.getCustomerStaffInfo);

// POST
router.post("/upsert", verifyInternalRequest, CustomerController.upsert);
router.post("/apply-referral", verifyInternalRequest, CustomerController.applyReferral);
router.post("/bulk-upsert", verifyInternalRequest, CustomerController.bulkUpsert);
router.post("/:id/assign", authenticate, canManage("crm"), CustomerController.assignCustomer);
router.patch("/:id/reassign", authenticate, isAdmin, CustomerController.reassignCustomer);
router.patch("/:id/unassign-sale", authenticate, isAdmin, CustomerController.unassignSale);

module.exports = router;

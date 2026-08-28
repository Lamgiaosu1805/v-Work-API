const express = require("express");
const {
  authenticate,
  hasModuleAccess,
  canManage,
  isAdmin
} = require("../middlewares/authMiddleware");
const CustomerController = require("../controllers/CustomerController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");

const router = express.Router();

// GET
router.get(
  "/my-customers",
  authenticate,
  hasModuleAccess("crm"),
  CustomerController.getMyCustomers
);
router.get("/agent-customers", verifyInternalRequest, CustomerController.getMyCustomersAsAgent);
router.get("/my-info", authenticate, CustomerController.getMyInfo);
router.get("/all", authenticate, canManage("crm"), CustomerController.getAll);
router.get("/export-excel", authenticate, hasModuleAccess("crm"), CustomerController.exportExcel);
router.get(
  "/detail-info-customer",
  authenticate,
  canManage("crm"),
  CustomerController.getDetailInfo
);
router.get("/fluctuation", authenticate, hasModuleAccess("crm"), CustomerController.getFluctuation);
router.get("/view-image", authenticate, hasModuleAccess("crm"), CustomerController.getViewImage);
router.get(
  "/investment-holding",
  authenticate,
  canManage("crm"),
  CustomerController.getCustomerInvestmentHolding
);
router.get(
  "/staff-info",
  authenticate,
  hasModuleAccess("crm"),
  CustomerController.getCustomerStaffInfo
);

// POST
router.post("/upsert", verifyInternalRequest, CustomerController.upsert);
router.post("/apply-referral", verifyInternalRequest, CustomerController.applyReferral);
router.post("/bulk-upsert", verifyInternalRequest, CustomerController.bulkUpsert);
router.post(
  "/interactions/:externalId",
  authenticate,
  hasModuleAccess("crm"),
  CustomerInteractionController.create
);
router.post("/bulk-assign", authenticate, canManage("crm"), CustomerController.bulkAssignCustomer);
router.post("/:id/assign", authenticate, canManage("crm"), CustomerController.assignCustomer);
router.patch("/:id/reassign", authenticate, isAdmin, CustomerController.reassignCustomer);
router.patch("/:id/unassign-sale", authenticate, isAdmin, CustomerController.unassignSale);

module.exports = router;

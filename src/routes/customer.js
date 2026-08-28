const express = require("express");
const { authenticate, hasModuleAccess } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
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
router.get(
  "/all",
  authenticate,
  requirePermission("customer.view", "Customer"),
  CustomerController.getAll
);
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
const canAssignCustomer = requirePermission("customer.assign", "Customer");
router.post("/:id/assign", authenticate, canAssignCustomer, CustomerController.assignCustomer);
router.patch("/:id/reassign", authenticate, canAssignCustomer, CustomerController.reassignCustomer);
router.patch(
  "/:id/unassign-sale",
  authenticate,
  canAssignCustomer,
  CustomerController.unassignSale
);

module.exports = router;

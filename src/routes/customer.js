const express = require("express");
const { authenticate, hasModuleAccess, canManage } = require("../middlewares/authMiddleware");
const CustomerController = require("../controllers/CustomerController");
const CustomerInteractionController = require("../controllers/CustomerInteractionController");
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
router.get("/export-excel", authenticate, canManage("crm"), CustomerController.exportExcel);
router.get(
  "/detail-info-customer",
  authenticate,
  hasModuleAccess("crm"),
  CustomerController.getDetailInfo
);
router.get("/fluctuation", authenticate, hasModuleAccess("crm"), CustomerController.getFluctuation);
router.get("/view-image", authenticate, canManage("crm"), CustomerController.getViewImage);
router.get(
  "/investment-holding",
  authenticate,
  hasModuleAccess("crm"),
  CustomerController.getCustomerInvestmentHolding
);
router.get("/staff-info", authenticate, canManage("crm"), CustomerController.getCustomerStaffInfo);
router.get(
  "/interactions/:externalId",
  authenticate,
  hasModuleAccess("crm"),
  CustomerInteractionController.list
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
router.post("/:id/assign", authenticate, canManage("crm"), CustomerController.assignCustomer);
router.patch("/:id/reassign", authenticate, canManage("crm"), CustomerController.reassignCustomer);
router.patch("/:id/unassign-sale", authenticate, canManage("crm"), CustomerController.unassignSale);

module.exports = router;

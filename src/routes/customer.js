const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const CustomerController = require("../controllers/CustomerController");
// const CustomerInteractionController = require("../controllers/CustomerInteractionController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");

const router = express.Router();

const viewCustomer = requirePermission("customer.view", "Customer");
const canAssignCustomer = requirePermission("customer.assign", "Customer");

// GET
router.get("/my-customers", authenticate, viewCustomer, CustomerController.getMyCustomers);
router.get("/agent-customers", verifyInternalRequest, CustomerController.getMyCustomersAsAgent);
router.get("/my-info", authenticate, CustomerController.getMyInfo);
router.get("/all", authenticate, viewCustomer, CustomerController.getAll);
router.get("/export-excel", authenticate, viewCustomer, CustomerController.exportExcel);
router.get(
  "/detail-info-customer",
  authenticate,
  viewCustomer,
  CustomerController.getDetailInfo
);
router.get("/fluctuation", authenticate, viewCustomer, CustomerController.getFluctuation);
router.get("/view-image", authenticate, viewCustomer, CustomerController.getViewImage);
router.get(
  "/investment-holding",
  authenticate,
  viewCustomer,
  CustomerController.getCustomerInvestmentHolding
);
router.get(
  "/staff-info",
  authenticate,
  viewCustomer,
  CustomerController.getCustomerStaffInfo
);
// router.get(
//   "/interactions/:externalId",
//   authenticate,
//   viewCustomer,
//   CustomerInteractionController.list
// );

// POST
router.post("/upsert", verifyInternalRequest, CustomerController.upsert);
router.post("/apply-referral", verifyInternalRequest, CustomerController.applyReferral);
router.post("/bulk-upsert", verifyInternalRequest, CustomerController.bulkUpsert);
// router.post(
//   "/interactions/:externalId",
//   authenticate,
//   viewCustomer,
//   CustomerInteractionController.create
// );
router.post(
  "/bulk-assign",
  authenticate,
  canAssignCustomer,
  CustomerController.bulkAssignCustomer
);
router.post("/:id/assign", authenticate, canAssignCustomer, CustomerController.assignCustomer);
router.patch(
  "/:id/reassign",
  authenticate,
  canAssignCustomer,
  CustomerController.reassignCustomer
);
router.patch(
  "/:id/unassign-sale",
  authenticate,
  canAssignCustomer,
  CustomerController.unassignSale
);

module.exports = router;

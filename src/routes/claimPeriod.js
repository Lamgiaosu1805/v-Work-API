const express = require("express");
const router = express.Router();
const ClaimPeriodController = require("../controllers/ClaimPeriodController");
const { authenticate, hasModuleAccess } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

// Admin only
router.post(
  "/",
  authenticate,
  requirePermission("claim_period.manage", "ClaimPeriod"),
  ClaimPeriodController.create
);
router.patch(
  "/:id/close",
  authenticate,
  requirePermission("claim_period.close", "ClaimPeriod"),
  ClaimPeriodController.close
);
router.get(
  "/history",
  authenticate,
  requirePermission("claim_period.view", "ClaimPeriod"),
  ClaimPeriodController.getHistory
);

// Tất cả user có CRM access
router.get("/status", authenticate, hasModuleAccess("crm"), ClaimPeriodController.getStatus);
router.get("/unclaimed-customers", authenticate, hasModuleAccess("crm"), ClaimPeriodController.getUnclaimedCustomers);
router.post("/claim", authenticate, hasModuleAccess("crm"), ClaimPeriodController.claimCustomer);

module.exports = router;

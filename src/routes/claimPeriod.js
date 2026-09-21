const express = require("express");
const router = express.Router();
const ClaimPeriodController = require("../controllers/ClaimPeriodController");
const { authenticate } = require("../middlewares/authMiddleware");
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

// Tất cả sale có quyền "nhận khách chưa ai phụ trách" (customer.claim)
router.get(
  "/status",
  authenticate,
  requirePermission("customer.claim", "Customer"),
  ClaimPeriodController.getStatus
);
router.get(
  "/unclaimed-customers",
  authenticate,
  requirePermission("customer.claim", "Customer"),
  ClaimPeriodController.getUnclaimedCustomers
);
router.post(
  "/claim",
  authenticate,
  requirePermission("customer.claim", "Customer"),
  ClaimPeriodController.claimCustomer
);

module.exports = router;

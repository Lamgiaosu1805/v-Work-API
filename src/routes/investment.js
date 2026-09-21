const express = require("express");
const router = express.Router();
const InvestmentController = require("../controllers/InvestmentController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

// Hệ thống đầu tư gọi
router.post("/upsert", verifyInternalRequest, InvestmentController.upsert);
router.post("/bulk-sync", verifyInternalRequest, InvestmentController.bulkSync);
router.get("/agent-commission", verifyInternalRequest, InvestmentController.getAgentCommission);

// Sale nội bộ đăng nhập CRM
router.get("/my-commission", authenticate, InvestmentController.getMyCommission);
router.get(
  "/staff-commission",
  authenticate,
  requirePermission("commission.view", "Commission"),
  InvestmentController.getStaffCommission
);
router.get(
  "/sales-chart",
  authenticate,
  requirePermission("investment.view", "Investment"),
  InvestmentController.getSalesChart
);
router.get(
  "/list",
  authenticate,
  requirePermission("investment.view", "Investment"),
  InvestmentController.list
);
router.get(
  "/expiring",
  authenticate,
  requirePermission("investment.view", "Investment"),
  InvestmentController.getExpiring
);
router.get(
  "/leaderboard",
  authenticate,
  requirePermission("investment.leaderboard", "Investment"),
  InvestmentController.getLeaderboard
);
router.get(
  "/conversion",
  authenticate,
  requirePermission("investment.view", "Investment"),
  InvestmentController.getConversion
);

module.exports = router;

const express = require("express");
const router = express.Router();
const InvestmentController = require("../controllers/InvestmentController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");
const { authenticate, hasModuleAccess, canManage } = require("../middlewares/authMiddleware");

// Hệ thống đầu tư gọi
router.post("/upsert", verifyInternalRequest, InvestmentController.upsert);
router.post("/bulk-sync", verifyInternalRequest, InvestmentController.bulkSync);
router.get("/agent-commission", verifyInternalRequest, InvestmentController.getAgentCommission);

// Sale nội bộ đăng nhập CRM
router.get("/my-commission", authenticate, hasModuleAccess("crm"), InvestmentController.getMyCommission);
router.get("/staff-commission", authenticate, canManage("crm"), InvestmentController.getStaffCommission);
router.get("/sales-chart", authenticate, hasModuleAccess("crm"), InvestmentController.getSalesChart);
router.get("/list", authenticate, hasModuleAccess("crm"), InvestmentController.list);
router.get("/expiring", authenticate, hasModuleAccess("crm"), InvestmentController.getExpiring);
router.get("/leaderboard", authenticate, hasModuleAccess("crm"), InvestmentController.getLeaderboard);
router.get("/conversion", authenticate, hasModuleAccess("crm"), InvestmentController.getConversion);

module.exports = router;

const express = require("express");
const router = express.Router();
const InvestmentController = require("../controllers/InvestmentController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");
const { authenticate } = require("../middlewares/authMiddleware");

// Hệ thống đầu tư gọi
router.post("/upsert", verifyInternalRequest, InvestmentController.upsert);
router.post("/bulk-sync", verifyInternalRequest, InvestmentController.bulkSync);

router.get("/agent-commission", verifyInternalRequest, InvestmentController.getAgentCommission);

// Sale nội bộ đăng nhập CRM
router.get("/my-commission", authenticate, InvestmentController.getMyCommission);

module.exports = router;
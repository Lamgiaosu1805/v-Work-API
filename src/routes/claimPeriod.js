const express = require("express");
const router = express.Router();
const ClaimPeriodController = require("../controllers/ClaimPeriodController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

// Admin
router.post("/", authenticate, isAdmin, ClaimPeriodController.create);
router.patch("/:id/close", authenticate, isAdmin, ClaimPeriodController.close);
router.get("/history", authenticate, isAdmin, ClaimPeriodController.getHistory);

// Tất cả sale đã đăng nhập
router.get("/status", authenticate, ClaimPeriodController.getStatus);
router.get("/unclaimed-customers", authenticate, ClaimPeriodController.getUnclaimedCustomers);
router.post("/claim", authenticate, ClaimPeriodController.claimCustomer);

module.exports = router;
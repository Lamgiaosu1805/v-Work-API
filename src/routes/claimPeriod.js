const express = require("express");
const router = express.Router();
const ClaimPeriodController = require("../controllers/ClaimPeriodController");
const { authenticate, isAdmin, hasModuleAccess, canManage } = require("../middlewares/authMiddleware");

// Admin only
router.post("/", authenticate, isAdmin, ClaimPeriodController.create);
router.patch("/:id/close", authenticate, isAdmin, ClaimPeriodController.close);
router.get("/history", authenticate, canManage("crm"), ClaimPeriodController.getHistory);

// Tất cả user có CRM access
router.get("/status", authenticate, hasModuleAccess("crm"), ClaimPeriodController.getStatus);
router.get("/unclaimed-customers", authenticate, hasModuleAccess("crm"), ClaimPeriodController.getUnclaimedCustomers);
router.post("/claim", authenticate, hasModuleAccess("crm"), ClaimPeriodController.claimCustomer);

module.exports = router;

const express = require("express");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const TransactionManagementController = require("../controllers/TransactionManagementController");
const rateLimit = require("express-rate-limit");

const manualDepositLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    const resetTime = req.rateLimit.resetTime;

    const retryAfter = Math.max(
      1,
      Math.ceil((resetTime.getTime() - Date.now()) / 1000)
    );

    return res.status(429).json({
      message: `Vui lòng chờ ${retryAfter} giây trước khi thực hiện lại`,
      retryAfter,
    });
  },
});

router.get("/",  authenticate, requirePermission("transaction.view", "Transaction"), TransactionManagementController.getTransactions);
router.post("/recharge-customer",  authenticate, requirePermission("transaction.create", "Transaction"), upload.single("file"), manualDepositLimiter, TransactionManagementController.createManualDeposit);
router.post("/recharge-customer/:id",  authenticate, requirePermission("transaction.create", "Transaction"), upload.single("file"), manualDepositLimiter, TransactionManagementController.requestAccounting);
router.get("/customer-deposits",  authenticate, requirePermission("transaction.view", "Transaction"), TransactionManagementController.getCustomerDepositTransactions);

module.exports = router;
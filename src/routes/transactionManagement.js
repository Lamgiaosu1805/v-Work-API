const express = require("express");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const { authenticate, hasModuleAccess } = require("../middlewares/authMiddleware");
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

router.get("/",  authenticate, hasModuleAccess("crm"), TransactionManagementController.getTransactions);
router.post("/recharge-customer",  authenticate, hasModuleAccess("crm"), upload.single("file"), manualDepositLimiter, TransactionManagementController.createManualDeposit);
router.post("/recharge-customer/:id",  authenticate, hasModuleAccess("crm"), upload.single("file"), manualDepositLimiter, TransactionManagementController.requestAccounting);
router.get("/customer-deposits",  authenticate, hasModuleAccess("crm"), TransactionManagementController.getCustomerDepositTransactions);

module.exports = router;
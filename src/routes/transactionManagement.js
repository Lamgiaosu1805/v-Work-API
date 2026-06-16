const express = require("express");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
const { authenticate, hasModuleAccess } = require("../middlewares/authMiddleware");
const TransactionManagementController = require("../controllers/TransactionManagementController");

router.get("/",  authenticate, hasModuleAccess("crm"), TransactionManagementController.getTransactions);
router.post("/recharge-customer",  authenticate, hasModuleAccess("crm"), upload.single("file"), TransactionManagementController.createManualDeposit);
router.post("/recharge-customer/:id",  authenticate, hasModuleAccess("crm"), upload.single("file"), TransactionManagementController.requestAccounting);

module.exports = router;
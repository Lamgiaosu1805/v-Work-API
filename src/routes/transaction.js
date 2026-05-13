const express = require("express");
const router = express.Router();
const TransactionController = require("../controllers/TransactionController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");

router.post("/sync-history", verifyInternalRequest, TransactionController.syncHistory);

module.exports = router;

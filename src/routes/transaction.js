const express = require("express");
const router = express.Router();
const TransactionController = require("../controllers/TransactionController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");

router.post("/sync-history", TransactionController.syncHistory);

module.exports = router;

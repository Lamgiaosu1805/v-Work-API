const express = require("express");
const router = express.Router();
const OmicallController = require("../controllers/OmicallController");

router.post("/call-hooks", OmicallController.callHooks);
router.get("/call-hooks", OmicallController.getLogs);

module.exports = router;

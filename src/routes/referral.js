const express = require("express");
const router = express.Router();
const ReferralController = require("../controllers/ReferralController");

router.post("/track", ReferralController.track);
router.get("/resolve", ReferralController.resolve);

module.exports = router;
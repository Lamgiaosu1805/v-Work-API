const express = require("express");
const router = express.Router();
const ReferralController = require("../controllers/ReferralController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");

router.post("/track", ReferralController.track);

router.get("/resolve", ReferralController.resolve);
router.get("/check", verifyInternalRequest, ReferralController.checkReferral);

module.exports = router;
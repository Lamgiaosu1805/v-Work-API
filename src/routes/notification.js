const express = require("express");
const router = express.Router();
const NotificationController = require("../controllers/NotificationController");
const { authenticate } = require("../middlewares/authMiddleware");

router.post("/device-token", authenticate, NotificationController.registerDeviceToken);
router.delete("/device-token", authenticate, NotificationController.unregisterDeviceToken);
router.post("/test", NotificationController.testSend);

module.exports = router;
const express = require("express");
const router = express.Router();
const NotificationController = require("../controllers/NotificationController");
const { authenticate } = require("../middlewares/authMiddleware");

router.get("/", authenticate, NotificationController.list);
router.get("/unread-count", authenticate, NotificationController.unreadCount);
router.patch("/read-all", authenticate, NotificationController.markAllRead);
router.patch("/:id/read", authenticate, NotificationController.markRead);

router.post("/device-token", authenticate, NotificationController.registerDeviceToken);
router.delete("/device-token", authenticate, NotificationController.unregisterDeviceToken);
router.post("/test", NotificationController.testSend);

module.exports = router;
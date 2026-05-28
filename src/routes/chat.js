const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const ChatController = require("../controllers/ChatController");

const router = express.Router();

router.post("/private", authenticate, ChatController.createPrivateChat);
router.post("/group", authenticate, ChatController.createGroupChat);
router.get("/conversations", authenticate, ChatController.getMyConversations);
router.get(
  "/conversations/:conversationId",
  authenticate,
  ChatController.getConversationDetail,
);
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  ChatController.getConversationMessages,
);
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  ChatController.sendMessage,
);
router.patch(
  "/conversations/:conversationId/seen",
  authenticate,
  ChatController.markConversationSeen,
);

module.exports = router;

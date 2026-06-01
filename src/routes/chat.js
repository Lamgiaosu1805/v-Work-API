const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const ChatController = require("../controllers/ChatController");

const router = express.Router();

router.get("/users/search", authenticate, ChatController.searchUsers);
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
router.patch(
  "/conversations/:conversationId/group-name",
  authenticate,
  ChatController.updateGroupConversationName,
);
router.delete(
  "/conversations/:conversationId",
  authenticate,
  ChatController.deleteConversation,
);
router.delete(
  "/conversations/:conversationId/messages/:messageId",
  authenticate,
  ChatController.deleteMessage,
);

module.exports = router;

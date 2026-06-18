const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const ChatController = require("../controllers/ChatController");
const { upload, processChatImage } = require("../middlewares/uploadChatImage");

const router = express.Router();

router.get("/users/search", authenticate, ChatController.searchUsers);
router.post("/private", authenticate, ChatController.createPrivateChat);
router.post("/group", authenticate, ChatController.createGroupChat);
router.get("/conversations", authenticate, ChatController.getMyConversations);
router.get("/conversations/:conversationId", authenticate, ChatController.getConversationDetail);
router.get(
  "/conversations/:conversationId/messages",
  authenticate,
  ChatController.getConversationMessages
);
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  upload.single("image"),
  processChatImage,
  ChatController.sendMessage
);
router.get(
  "/conversations/:conversationId/messages/:messageId/image",
  authenticate,
  ChatController.getMessageImage
);

router.patch(
  "/conversations/:conversationId/group-name",
  authenticate,
  ChatController.updateGroupConversationName
);
router.delete("/conversations/:conversationId", authenticate, ChatController.deleteConversation);
router.post("/conversations/:conversationId/members", authenticate, ChatController.addMembers);
router.delete("/conversations/:conversationId/members/me", authenticate, ChatController.leaveGroup);
router.delete(
  "/conversations/:conversationId/members/:memberId",
  authenticate,
  ChatController.kickMember
);
router.patch(
  "/conversations/:conversationId/members/:memberId/promote",
  authenticate,
  ChatController.promoteMember
);
router.delete(
  "/conversations/:conversationId/messages/:messageId",
  authenticate,
  ChatController.recallMessage
);
router.delete(
  "/conversations/:conversationId/messages/:messageId/self",
  authenticate,
  ChatController.deleteMessageForSelf
);

module.exports = router;

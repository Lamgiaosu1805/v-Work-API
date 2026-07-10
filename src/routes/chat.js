const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const ChatController = require("../controllers/ChatController");
const { upload, processChatImage, uploadGroupAvatar } = require("../middlewares/uploadChatImage");

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

router.post(
  "/conversations/:conversationId/messages/:messageId/react",
  authenticate,
  ChatController.reactToMessage
);

router.get(
  "/conversations/:conversationId/messages/:messageId/image",
  authenticate,
  ChatController.getMessageImage
);

router.get(
  "/conversations/:conversationId/messages/:messageId",
  authenticate,
  ChatController.getMessageById
);

router.get(
  "/conversations/:conversationId/images",
  authenticate,
  ChatController.getConversationImages
);

router.patch(
  "/conversations/:conversationId/group-name",
  authenticate,
  ChatController.updateGroupConversationName
);

router.patch(
  "/conversations/:conversationId/group-avatar",
  authenticate,
  uploadGroupAvatar.single("group-avatar"),
  processChatImage,
  ChatController.updateGroupConversationAvatar
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

router.patch(
  "/conversations/:conversationId/members/:memberId/nickname",
  authenticate,
  ChatController.updateMemberNickname
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

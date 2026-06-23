const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { sendChatMessageNotification } = require("../helpers/chatNotification");
const UserInfoModel = require("../models/UserInfoModel");
const MessageModel = require("../models/MessageModel");
const ConversationModel = require("../models/ConversationModel");
const { getChatDir } = require("../middlewares/uploadChatImage");
const { handleChatError } = require("../helpers/socketHandler");
const { signAvatarsDeep } = require("../helpers/staticUrl");
const {
  getCurrentUserInfo,
  createPrivateConversation,
  createGroupConversation,
  updateGroupConversationName,
  listConversations,
  getConversationMessages,
  sendMessage,
  getConversationDetail,
  deleteConversation,
  recallMessage,
  deleteMessageForSelf,
  kickMember,
  promoteMember,
  leaveGroup,
  addMembers,
  ensureConversationAccess
} = require("../services/chatService");

const CONTENT_TYPE_MAP = {
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

function emitConversationEvent(io, eventName, conversation, payload) {
  if (!io || !conversation?.members) return;

  const memberIds = conversation.members
    .map((member) => String(member?._id || member))
    .filter(Boolean);

  const signedPayload = signAvatarsDeep(payload);
  memberIds.forEach((memberId) => {
    io.to(`user:${memberId}`).emit(eventName, signedPayload);
  });
}

async function broadcastNewMessage({ req, currentUserInfo, message, clientMessageId }) {
  const io = req.app.get("io");
  let conversation = null;
  if (!io) return { conversation };

  const payload = {
    conversationId: String(message.conversationId),
    message: signAvatarsDeep(message),
    clientMessageId: clientMessageId ?? null
  };

  io.to(`conversation:${String(message.conversationId)}`).emit("message:new", payload);

  conversation = await getConversationDetail({
    conversationId: message.conversationId,
    userInfoId: currentUserInfo._id
  });

  emitConversationEvent(io, "conversation:upserted", conversation, { conversation });

  return { conversation };
}

async function createAndBroadcastSystemMessage({ io, conversationId, actorUserInfoId, content }) {
  const message = await MessageModel.create({
    conversationId,
    senderId: actorUserInfoId,
    type: "system",
    content,
    seenBy: [actorUserInfoId]
  });

  await ConversationModel.updateOne(
    { _id: conversationId },
    { $set: { lastMessage: message._id, updatedAt: new Date() } }
  );

  const populated = await MessageModel.findById(message._id)
    .populate("senderId", "full_name avatar ma_nv id_account")
    .lean();

  if (io) {
    io.to(`conversation:${String(conversationId)}`).emit("message:new", {
      conversationId: String(conversationId),
      message: signAvatarsDeep(populated),
      clientMessageId: null
    });
  }
}

const ChatController = {
  createPrivateChat: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await createPrivateConversation({
        currentUserInfoId: currentUserInfo._id,
        receiverUserInfoId: req.body.receiver_id
      });

      emitConversationEvent(req.app.get("io"), "conversation:upserted", conversation, {
        conversation
      });

      return res.status(201).json({
        message: "Tạo private chat thành công",
        data: signAvatarsDeep(conversation)
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  createGroupChat: async (req, res) => {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await createGroupConversation({
        name: req.body.name,
        memberIds: req.body.members,
        creatorUserInfoId: currentUserInfo._id,
        session
      });

      await session.commitTransaction();

      emitConversationEvent(req.app.get("io"), "conversation:upserted", conversation, {
        conversation
      });

      return res.status(201).json({
        message: "Tạo group chat thành công",
        data: signAvatarsDeep(conversation)
      });
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return handleChatError(res, error);
    } finally {
      session.endSession();
    }
  },

  updateGroupConversationName: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await updateGroupConversationName({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
        name: req.body.name
      });

      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
      }

      await createAndBroadcastSystemMessage({
        io,
        conversationId: req.params.conversationId,
        actorUserInfoId: currentUserInfo._id,
        content: `${currentUserInfo.full_name} đã đổi tên nhóm thành "${req.body.name}"`
      });

      return res.status(200).json({
        message: "Cập nhật tên nhóm thành công",
        data: signAvatarsDeep(conversation)
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  getMyConversations: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversations = await listConversations(currentUserInfo._id, req.query.search);

      return res.status(200).json({
        message: "Lấy danh sách conversation thành công",
        data: signAvatarsDeep(conversations)
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  getConversationDetail: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await getConversationDetail({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id
      });

      return res.status(200).json({
        message: "Lấy chi tiết conversation thành công",
        data: signAvatarsDeep(conversation)
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  getConversationMessages: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

      const result = await getConversationMessages({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
        page,
        limit
      });

      return res.status(200).json({
        message: "Lấy danh sách tin nhắn thành công",
        ...signAvatarsDeep(result)
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  sendMessage: async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const attachment = req.file
        ? {
            url: `chat/${req.params.conversationId}/${req.file.filename}`,
            thumbnailUrl: null,
            mimeType: req.file.mimetype,
            size: req.file.size,
            width: req.file.width ?? null,
            height: req.file.height ?? null,
            originalName: req.file.originalname
          }
        : null;

      session.startTransaction();
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const message = await sendMessage({
        conversationId: req.params.conversationId,
        senderUserInfoId: currentUserInfo._id,
        content: req.body.content,
        type: attachment ? "image" : req.body.type,
        attachment,
        session
      });
      await session.commitTransaction();

      res.status(201).json({
        message: "Gửi tin nhắn thành công",
        data: signAvatarsDeep(message),
        clientMessageId: req.body.clientMessageId ?? null
      });

      const io = req.app.get("io");
      broadcastNewMessage({
        req,
        currentUserInfo,
        message,
        clientMessageId: req.body.clientMessageId
      })
        .then(({ conversation }) =>
          sendChatMessageNotification({
            io,
            conversationId: message.conversationId,
            senderUserInfoId: currentUserInfo._id,
            senderName: currentUserInfo.full_name,
            message,
            conversation
          })
        )
        .catch((err) => console.error("[sendMessage] post-processing error:", err));
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
        if (req.file) {
          const chatDir = getChatDir(req.params.conversationId);
          [req.file.filename, req.file.thumbnailFilename].filter(Boolean).forEach((name) => {
            const filePath = path.join(chatDir, name);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          });
        }
      }
      return handleChatError(res, error);
    } finally {
      session.endSession();
    }
  },

  getMessageImage: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      await ensureConversationAccess(req.params.conversationId, currentUserInfo._id);

      const message = await MessageModel.findOne({
        _id: req.params.messageId,
        conversationId: req.params.conversationId,
        type: "image",
        isDeleted: false,
        "recalled.at": null
      }).lean();

      if (!message?.attachment?.url) {
        return res.status(404).json({ message: "Không tìm thấy ảnh" });
      }

      const variant = req.query.variant === "thumb" ? "thumbnailUrl" : "url";
      const relativePath = message.attachment[variant] ?? message.attachment.url;

      const baseDir =
        process.env.NODE_ENV === "production"
          ? process.env.UPLOAD_DIR_PROD
          : process.env.UPLOAD_DIR_DEV;
      const filePath = path.resolve(baseDir, relativePath);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File ảnh không tồn tại trên server" });
      }

      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", CONTENT_TYPE_MAP[ext] ?? "application/octet-stream");
      return res.sendFile(filePath);
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  deleteConversation: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await deleteConversation({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`user:${String(currentUserInfo._id)}`).emit("conversation:deleted", {
          conversationId: String(req.params.conversationId)
        });
      }

      return res.status(200).json({
        message: "Xoá conversation thành công",
        data: result
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  searchUsers: async (req, res) => {
    try {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const currentUserInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false
      })
        .select("_id")
        .lean();
      const search = String(req.query.search ?? "").trim();
      const safe = escapeRegex(search);
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));

      const filter = {
        ...(currentUserInfo && { _id: { $ne: currentUserInfo._id } }),
        isDeleted: false,
        ...(search && {
          $or: [
            { full_name: { $regex: safe, $options: "i" } },
            { ma_nv: { $regex: safe, $options: "i" } }
          ]
        })
      };

      const users = await UserInfoModel.find(filter)
        .select("_id full_name ma_nv avatar")
        .limit(limit)
        .lean();

      return res.status(200).json({ message: "Tìm kiếm thành công", data: signAvatarsDeep(users) });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  recallMessage: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const message = await recallMessage({
        conversationId: req.params.conversationId,
        messageId: req.params.messageId,
        userInfoId: currentUserInfo._id
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`conversation:${String(req.params.conversationId)}`).emit("message:recalled", {
          conversationId: String(req.params.conversationId),
          message
        });

        const conversation = await getConversationDetail({
          conversationId: req.params.conversationId,
          userInfoId: currentUserInfo._id
        });
        emitConversationEvent(io, "conversation:upserted", conversation, {
          conversation
        });
      }

      return res.status(200).json({
        message: "Thu hồi tin nhắn thành công",
        data: message
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  addMembers: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const newMemberIds = req.body.member_ids ?? [];

      const newMembers = await UserInfoModel.find({
        _id: { $in: newMemberIds },
        isDeleted: false
      })
        .select("full_name")
        .lean();

      const conversation = await addMembers({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
        newMemberIds
      });

      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
      }

      for (const member of newMembers) {
        await createAndBroadcastSystemMessage({
          io,
          conversationId: req.params.conversationId,
          actorUserInfoId: currentUserInfo._id,
          content: `${currentUserInfo.full_name} đã thêm ${member.full_name} vào nhóm`
        });
      }

      return res.status(200).json({ message: "Thêm thành viên thành công", data: conversation });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  kickMember: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const targetUserInfo = await UserInfoModel.findById(req.params.memberId)
        .select("full_name")
        .lean();
      const conversation = await kickMember({
        conversationId: req.params.conversationId,
        adminUserInfoId: currentUserInfo._id,
        targetUserInfoId: req.params.memberId
      });
      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
        io.to(`user:${req.params.memberId}`).emit("conversation:deleted", {
          conversationId: String(req.params.conversationId)
        });
      }
      if (targetUserInfo) {
        await createAndBroadcastSystemMessage({
          io,
          conversationId: req.params.conversationId,
          actorUserInfoId: currentUserInfo._id,
          content: `${currentUserInfo.full_name} đã xóa ${targetUserInfo.full_name} khỏi nhóm`
        });
      }
      return res
        .status(200)
        .json({ message: "Xóa thành viên thành công", data: signAvatarsDeep(conversation) });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  promoteMember: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const targetUserInfo = await UserInfoModel.findById(req.params.memberId)
        .select("full_name")
        .lean();
      const conversation = await promoteMember({
        conversationId: req.params.conversationId,
        adminUserInfoId: currentUserInfo._id,
        targetUserInfoId: req.params.memberId
      });
      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
      }
      if (targetUserInfo) {
        await createAndBroadcastSystemMessage({
          io,
          conversationId: req.params.conversationId,
          actorUserInfoId: currentUserInfo._id,
          content: `${currentUserInfo.full_name} đã thăng ${targetUserInfo.full_name} lên trưởng nhóm`
        });
      }
      return res
        .status(200)
        .json({ message: "Thăng chức thành công", data: signAvatarsDeep(conversation) });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  leaveGroup: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await leaveGroup({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id
      });
      const io = req.app.get("io");

      if (!result.disbanded) {
        await createAndBroadcastSystemMessage({
          io,
          conversationId: req.params.conversationId,
          actorUserInfoId: currentUserInfo._id,
          content: `${currentUserInfo.full_name} đã rời khỏi nhóm`
        });
      }

      if (io) {
        if (!result.disbanded && result.conversation) {
          emitConversationEvent(io, "conversation:upserted", result.conversation, {
            conversation: result.conversation
          });
        }
        io.to(`user:${String(currentUserInfo._id)}`).emit("conversation:deleted", {
          conversationId: String(req.params.conversationId)
        });
      }
      return res.status(200).json({ message: "Rời nhóm thành công" });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  deleteMessageForSelf: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await deleteMessageForSelf({
        conversationId: req.params.conversationId,
        messageId: req.params.messageId,
        userInfoId: currentUserInfo._id
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`user:${String(currentUserInfo._id)}`).emit("message:deleted_for_self", {
          conversationId: String(req.params.conversationId),
          messageId: String(req.params.messageId)
        });
      }

      return res.status(200).json({
        message: "Xoá tin nhắn thành công",
        data: result
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  }
};

module.exports = ChatController;

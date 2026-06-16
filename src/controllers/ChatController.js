const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { sendChatMessageNotification } = require("../helpers/chatNotification");
const UserInfoModel = require("../models/UserInfoModel");
const MessageModel = require("../models/MessageModel");
const { getChatDir } = require("../middlewares/uploadChatImage");

const {
  ChatError,
  getCurrentUserInfo,
  createPrivateConversation,
  createGroupConversation,
  updateGroupConversationName,
  listConversations,
  getConversationMessages,
  sendMessage,
  markConversationSeen,
  getConversationDetail,
  deleteConversation,
  recallMessage,
  deleteMessageForSelf,
  kickMember,
  promoteMember,
  leaveGroup,
  addMembers,
  ensureConversationAccess,
} = require("../services/chatService");

const CONTENT_TYPE_MAP = {
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function handleChatError(res, error) {
  // Chuẩn hoá lỗi nghiệp vụ của chat để controller trả status phù hợp.
  if (error instanceof ChatError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  console.log("Error in ChatController:", error);
  return res.status(500).json({
    message: "Internal server error",
    error: error.message,
  });
}

function emitConversationEvent(io, eventName, conversation, payload) {
  if (!io || !conversation?.members) return;

  // Gửi event cho từng user room riêng, dùng cho update conversation list / badge.
  const memberIds = conversation.members
    .map((member) => String(member?._id || member))
    .filter(Boolean);

  memberIds.forEach((memberId) => {
    io.to(`user:${memberId}`).emit(eventName, payload);
  });
}

async function broadcastNewMessage({ req, currentUserInfo, message, clientMessageId }) {
  const io = req.app.get("io");
  let conversation = null;
  if (!io) return { conversation };

  const payload = {
    conversationId: String(message.conversationId),
    message,
    clientMessageId: clientMessageId ?? null,
  };

  io.to(`conversation:${String(message.conversationId)}`).emit("message:new", payload);

  conversation = await getConversationDetail({
    conversationId: message.conversationId,
    userInfoId: currentUserInfo._id,
  });

  emitConversationEvent(io, "conversation:upserted", conversation, { conversation });

  return { conversation };
}

const ChatController = {
  createPrivateChat: async (req, res) => {
    try {
      // Từ account hiện tại suy ra user_info để đi làm việc với chat domain.
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await createPrivateConversation({
        currentUserInfoId: currentUserInfo._id,
        receiverUserInfoId: req.body.receiver_id,
      });

      // Sau khi tạo chat xong thì đẩy event để frontend cập nhật list conversation.
      emitConversationEvent(
        req.app.get("io"),
        "conversation:upserted",
        conversation,
        {
          conversation,
        },
      );

      return res.status(201).json({
        message: "Tạo private chat thành công",
        data: conversation,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  createGroupChat: async (req, res) => {
    const session = await mongoose.startSession();

    try {
      // Tạo group chat dùng transaction vì có nhiều bước ghi DB liên quan.
      session.startTransaction();

      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await createGroupConversation({
        name: req.body.name,
        memberIds: req.body.members,
        creatorUserInfoId: currentUserInfo._id,
        session,
      });

      await session.commitTransaction();

      // Emit sau commit để tránh frontend nhận state khi transaction chưa hoàn tất.
      emitConversationEvent(
        req.app.get("io"),
        "conversation:upserted",
        conversation,
        {
          conversation,
        },
      );

      return res.status(201).json({
        message: "Tạo group chat thành công",
        data: conversation,
      });
    } catch (error) {
      await session.abortTransaction();
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
        name: req.body.name,
      });

      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, {
          conversation,
        });
      }

      return res.status(200).json({
        message: "Cập nhật tên nhóm thành công",
        data: conversation,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  getMyConversations: async (req, res) => {
    try {
      // Trả về danh sách conversation của riêng user hiện tại.
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversations = await listConversations(
        currentUserInfo._id,
        req.query.search,
      );

      return res.status(200).json({
        message: "Lấy danh sách conversation thành công",
        data: conversations,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  getConversationDetail: async (req, res) => {
    try {
      // Service sẽ kiểm tra user có thuộc conversation này hay không.
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await getConversationDetail({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
      });

      return res.status(200).json({
        message: "Lấy chi tiết conversation thành công",
        data: conversation,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  getConversationMessages: async (req, res) => {
    try {
      // Chuẩn hoá phân trang trước khi gọi service.
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(req.query.limit, 10) || 30),
      );

      const result = await getConversationMessages({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
        page,
        limit,
      });

      return res.status(200).json({
        message: "Lấy danh sách tin nhắn thành công",
        ...result,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  sendMessage: async (req, res) => {
    const session = await mongoose.startSession();
    try {
      // Route nhận multipart/form-data: có file -> tin nhắn ảnh, không có file -> tin nhắn text.
      const attachment = req.file
        ? {
            url: `chat/${req.params.conversationId}/${req.file.filename}`,
            thumbnailUrl: null,
            mimeType: req.file.mimetype,
            size: req.file.size,
            width: req.file.width ?? null,
            height: req.file.height ?? null,
            originalName: req.file.originalname,
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
        session,
      });
      await session.commitTransaction();

      const { conversation } = await broadcastNewMessage({
        req,
        currentUserInfo,
        message,
        clientMessageId: req.body.clientMessageId,
      });

      const io = req.app.get("io");
      await sendChatMessageNotification({
        io,
        conversationId: message.conversationId,
        senderUserInfoId: currentUserInfo._id,
        senderName: currentUserInfo.full_name,
        message,
        conversation,
      });

      return res.status(201).json({
        message: "Gửi tin nhắn thành công",
        data: message,
      });
    } catch (error) {
      // Chỉ dọn file trên đĩa khi DB ghi thất bại thật (transaction chưa commit).
      // Nếu lỗi xảy ra sau commit (vd: emit/notification), message đã lưu DB nên giữ file lại.
      if (session.inTransaction()) {
        await session.abortTransaction();
        if (req.file) {
          const chatDir = getChatDir(req.params.conversationId);
          [req.file.filename, req.file.thumbnailFilename]
            .filter(Boolean)
            .forEach((name) => {
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
        "recalled.at": null,
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

  markConversationSeen: async (req, res) => {
    try {
      // Service sẽ update seenBy cho toàn bộ message chưa đọc trong conversation.
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await markConversationSeen({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
      });

      const io = req.app.get("io");
      if (io) {
        // Báo cho các client khác biết conversation này vừa được đọc.
        io.to(`conversation:${String(req.params.conversationId)}`).emit(
          "message:seen",
          {
            conversationId: String(req.params.conversationId),
            userInfoId: String(currentUserInfo._id),
          },
        );
      }

      return res.status(200).json({
        message: "Đánh dấu đã đọc thành công",
        data: result,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  deleteConversation: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await deleteConversation({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
      });

      const io = req.app.get("io");
      if (io) {
        // Chỉ emit cho chính user này — người khác vẫn giữ nguyên conversation.
        io.to(`user:${String(currentUserInfo._id)}`).emit("conversation:deleted", {
          conversationId: String(req.params.conversationId),
        });
      }

      return res.status(200).json({
        message: "Xoá conversation thành công",
        data: result,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  searchUsers: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const search = (req.query.search ?? "").trim();
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));

      const filter = {
        _id: { $ne: currentUserInfo._id },
        isDeleted: false,
        ...(search && {
          $or: [
            { full_name: { $regex: search, $options: "i" } },
            { ma_nv: { $regex: search, $options: "i" } },
          ],
        }),
      };

      const users = await UserInfoModel.find(filter)
        .select("_id full_name ma_nv avatar")
        .limit(limit)
        .lean();

      return res.status(200).json({ message: "Tìm kiếm thành công", data: users });
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
        userInfoId: currentUserInfo._id,
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`conversation:${String(req.params.conversationId)}`).emit(
          "message:recalled",
          {
            conversationId: String(req.params.conversationId),
            message,
          },
        );

        const conversation = await getConversationDetail({
          conversationId: req.params.conversationId,
          userInfoId: currentUserInfo._id,
        });
        emitConversationEvent(io, "conversation:upserted", conversation, {
          conversation,
        });
      }

      return res.status(200).json({
        message: "Thu hồi tin nhắn thành công",
        data: message,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  addMembers: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await addMembers({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
        newMemberIds: req.body.member_ids,
      });
      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
      }
      return res.status(200).json({ message: "Thêm thành viên thành công", data: conversation });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  kickMember: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await kickMember({
        conversationId: req.params.conversationId,
        adminUserInfoId: currentUserInfo._id,
        targetUserInfoId: req.params.memberId,
      });
      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
        io.to(`user:${req.params.memberId}`).emit("conversation:deleted", {
          conversationId: String(req.params.conversationId),
        });
      }
      return res.status(200).json({ message: "Xóa thành viên thành công", data: conversation });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  promoteMember: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const conversation = await promoteMember({
        conversationId: req.params.conversationId,
        adminUserInfoId: currentUserInfo._id,
        targetUserInfoId: req.params.memberId,
      });
      const io = req.app.get("io");
      if (io) {
        emitConversationEvent(io, "conversation:upserted", conversation, { conversation });
      }
      return res.status(200).json({ message: "Thăng chức thành công", data: conversation });
    } catch (error) {
      return handleChatError(res, error);
    }
  },

  leaveGroup: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await leaveGroup({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
      });
      const io = req.app.get("io");
      if (io) {
        if (!result.disbanded && result.conversation) {
          emitConversationEvent(io, "conversation:upserted", result.conversation, {
            conversation: result.conversation,
          });
        }
        io.to(`user:${String(currentUserInfo._id)}`).emit("conversation:deleted", {
          conversationId: String(req.params.conversationId),
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
        userInfoId: currentUserInfo._id,
      });

      const io = req.app.get("io");
      if (io) {
        // Chỉ emit cho các thiết bị của chính user này để đồng bộ đa thiết bị.
        io.to(`user:${String(currentUserInfo._id)}`).emit("message:deleted_for_self", {
          conversationId: String(req.params.conversationId),
          messageId: String(req.params.messageId),
        });
      }

      return res.status(200).json({
        message: "Xoá tin nhắn thành công",
        data: result,
      });
    } catch (error) {
      return handleChatError(res, error);
    }
  },
};

module.exports = ChatController;

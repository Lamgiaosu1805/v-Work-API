const mongoose = require("mongoose");
const { sendChatMessageNotification } = require("../helpers/chatNotification");
const UserInfoModel = require("../models/UserInfoModel");

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
  deleteMessage,
} = require("../services/chatService");

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

function emitConversationMessageToMembers(io, conversation, payload) {
  if (!io || !conversation?.members?.length) return;

  // Dùng để broadcast tin nhắn mới cho toàn bộ thiết bị của các member.
  const memberIds = conversation.members
    .map((member) => String(member?._id || member))
    .filter((memberId) => memberId);

  memberIds.forEach((memberId) => {
    io.to(`user:${memberId}`).emit("message:new", payload);
  });
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
    try {
      // Gửi message qua service để validate quyền, lưu DB và trả message đã populate.
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const message = await sendMessage({
        conversationId: req.params.conversationId,
        senderUserInfoId: currentUserInfo._id,
        content: req.body.content,
        type: req.body.type,
      });

      const io = req.app.get("io");
      let conversation = null;
      if (io) {
        // Emit vào room conversation để tất cả client đang mở chat nhận ngay.
        io.to(`conversation:${String(message.conversationId)}`).emit(
          "message:new",
          {
            conversationId: String(message.conversationId),
            message,
            clientMessageId: req.body.clientMessageId ?? null,
          },
        );

        // Load lại conversation để có đủ members phục vụ emit theo từng user room.
        conversation = await getConversationDetail({
          conversationId: message.conversationId,
          userInfoId: currentUserInfo._id,
        });

        // Emit thêm theo từng user room để đồng bộ danh sách chat ở sidebar/inbox.
        emitConversationMessageToMembers(io, conversation, {
          conversationId: String(message.conversationId),
          message,
          clientMessageId: req.body.clientMessageId ?? null,
        });
      }

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
      const conversation = await getConversationDetail({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
      });

      const result = await deleteConversation({
        conversationId: req.params.conversationId,
        userInfoId: currentUserInfo._id,
      });

      const io = req.app.get("io");
      if (io) {
        // Báo cho client đang mở phòng chat.
        io.to(`conversation:${String(req.params.conversationId)}`).emit(
          "conversation:deleted",
          {
            conversationId: String(req.params.conversationId),
          },
        );

        // Báo theo user room để mọi thiết bị đều cập nhật danh sách conversation.
        emitConversationEvent(io, "conversation:deleted", conversation, {
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

  deleteMessage: async (req, res) => {
    try {
      const currentUserInfo = await getCurrentUserInfo(req.account._id);
      const result = await deleteMessage({
        conversationId: req.params.conversationId,
        messageId: req.params.messageId,
        userInfoId: currentUserInfo._id,
      });

      const io = req.app.get("io");
      if (io) {
        // Báo cho room conversation để UI ẩn/đánh dấu message vừa bị xoá mềm.
        io.to(`conversation:${String(req.params.conversationId)}`).emit(
          "message:deleted",
          {
            conversationId: String(req.params.conversationId),
            messageId: String(req.params.messageId),
          },
        );

        // Đồng bộ sidebar/inbox khi lastMessage thay đổi sau khi xoá.
        const conversation = await getConversationDetail({
          conversationId: req.params.conversationId,
          userInfoId: currentUserInfo._id,
        });
        emitConversationEvent(io, "conversation:upserted", conversation, {
          conversation,
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

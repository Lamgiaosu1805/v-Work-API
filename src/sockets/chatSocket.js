const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AccountModel = require("../models/AccountModel");
const ConversationModel = require("../models/ConversationModel");
const UserInfoModel = require("../models/UserInfoModel");
const { sendChatMessageNotification } = require("../helpers/chatNotification");
const {
  ChatError,
  getConversationDetail,
  sendMessage,
  markConversationSeen,
  deleteConversation,
  recallMessage
} = require("../services/chatService");

function getSocketToken(socket) {
  return (
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(" ")[1] ||
    socket.handshake.query?.token
  );
}

async function resolveSocketUser(socket) {
  const token = getSocketToken(socket);

  if (!token) return null;

  const decoded = jwt.verify(token, process.env.SECRET_KEY);
  const account = await AccountModel.findById(decoded.id).lean();
  if (!account || account.isDeleted) return null;

  const userInfo = await UserInfoModel.findOne({
    id_account: account._id,
    isDeleted: false
  })
    .select("full_name avatar ma_nv id_account")
    .lean();

  if (!userInfo) return null;

  return {
    accountId: String(account._id),
    userInfo
  };
}

function ack(ackFn, payload) {
  if (typeof ackFn === "function") {
    ackFn(payload);
  }
}

async function emitConversationEventToMembers(io, conversationId, eventName, payload) {
  const conversation = await ConversationModel.findById(conversationId).select("members").lean();

  if (!conversation?.members?.length) return;

  const memberIds = conversation.members
    .map((member) => String(member?._id || member))
    .filter((memberId) => memberId);

  memberIds.forEach((memberId) => {
    io.to(`user:${memberId}`).emit(eventName, payload);
  });
}

module.exports = function setupChatSocket(io) {
  io.use(async (socket, next) => {
    const token = getSocketToken(socket);
    if (!token) return next();

    try {
      const auth = await resolveSocketUser(socket);
      if (!auth) return next(new Error("Tài khoản không hợp lệ"));

      socket.data.accountId = auth.accountId;
      socket.data.userInfoId = String(auth.userInfo._id);
      socket.data.userInfo = auth.userInfo;
      return next();
    } catch (error) {
      return next(new Error("Token không hợp lệ"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.data.userInfoId) {
      socket.join(`user:${socket.data.userInfoId}`);
    }

    socket.on("chat:join", async (payload = {}, callback) => {
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        // Kiểm tra quyền truy cập conversation trước khi cho join room.
        const conversation = await getConversationDetail({
          conversationId: payload.conversationId,
          userInfoId: socket.data.userInfoId
        });

        // Room conversation:{id} là room chung của tất cả member trong cuộc chat này.
        socket.join(`conversation:${String(conversation._id)}`);
        ack(callback, { ok: true, data: conversation });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });

    socket.on("chat:leave", async (payload = {}, callback) => {
      try {
        socket.leave(`conversation:${String(payload.conversationId)}`);
        ack(callback, { ok: true });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });

    socket.on("chat:send", async (payload = {}, callback) => {
      const session = await mongoose.startSession();
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        session.startTransaction();
        const message = await sendMessage({
          conversationId: payload.conversationId,
          senderUserInfoId: socket.data.userInfoId,
          content: payload.content,
          type: payload.type,
          session
        });
        await session.commitTransaction();

        io.to(`conversation:${String(payload.conversationId)}`).emit("message:new", {
          conversationId: String(payload.conversationId),
          message,
          clientMessageId: payload.clientMessageId ?? null
        });

        const conversation = await getConversationDetail({
          conversationId: payload.conversationId,
          userInfoId: socket.data.userInfoId
        });

        await emitConversationEventToMembers(io, payload.conversationId, "conversation:upserted", {
          conversation
        });

        await sendChatMessageNotification({
          io,
          conversationId: payload.conversationId,
          senderUserInfoId: socket.data.userInfoId,
          senderName: socket.data.userInfo?.full_name,
          message,
          conversation
        });

        ack(callback, { ok: true, data: message });
      } catch (error) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        ack(callback, { ok: false, message: error.message });
      } finally {
        session.endSession();
      }
    });

    socket.on("chat:seen", async (payload = {}, callback) => {
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        // Đánh dấu toàn bộ message chưa đọc trong conversation là đã xem bởi user này.
        const result = await markConversationSeen({
          conversationId: payload.conversationId,
          userInfoId: socket.data.userInfoId
        });

        // Báo ngược lại cho cả room conversation để các client cập nhật trạng thái seen.
        io.to(`conversation:${String(payload.conversationId)}`).emit("message:seen", {
          conversationId: String(payload.conversationId),
          userInfoId: String(socket.data.userInfoId)
        });

        await emitConversationEventToMembers(io, payload.conversationId, "message:seen", {
          conversationId: String(payload.conversationId),
          userInfoId: String(socket.data.userInfoId)
        });

        ack(callback, { ok: true, data: result });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });

    socket.on("chat:deleteConversation", async (payload = {}, callback) => {
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        const conversationId = payload?.conversationId;
        if (!conversationId) {
          throw new ChatError("Thiếu conversationId", 400);
        }

        const conversation = await getConversationDetail({
          conversationId,
          userInfoId: socket.data.userInfoId
        });

        const result = await deleteConversation({
          conversationId,
          userInfoId: socket.data.userInfoId
        });

        io.to(`conversation:${String(conversationId)}`).emit("conversation:deleted", {
          conversationId: String(conversationId)
        });

        await emitConversationEventToMembers(io, conversationId, "conversation:deleted", {
          conversationId: String(conversationId)
        });

        ack(callback, { ok: true, data: result, conversation });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });

    socket.on("chat:deleteMessage", async (payload = {}, callback) => {
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        const conversationId = payload?.conversationId;
        const messageId = payload?.messageId;

        if (!conversationId || !messageId) {
          throw new ChatError("Thiếu conversationId hoặc messageId", 400);
        }

        const result = await recallMessage({
          conversationId,
          messageId,
          userInfoId: socket.data.userInfoId
        });

        io.to(`conversation:${String(conversationId)}`).emit("message:recalled", {
          conversationId: String(conversationId),
          message: result
        });

        const conversation = await getConversationDetail({
          conversationId,
          userInfoId: socket.data.userInfoId
        });

        await emitConversationEventToMembers(io, conversationId, "conversation:upserted", {
          conversation
        });

        ack(callback, { ok: true, data: result });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });
  });
};

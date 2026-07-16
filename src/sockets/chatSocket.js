const mongoose = require("mongoose");
const ConversationModel = require("../models/ConversationModel");
const { sendChatMessageNotification } = require("../helpers/chatNotification");
const { ack, onAuthed } = require("../helpers/socketHandler");
const {
  ChatError,
  getConversationDetail,
  sendMessage,
  markConversationSeen,
  deleteConversation,
  recallMessage,
  reactToMessage
} = require("../services/chatService");
const { getSocketToken, resolveSocketUser } = require("../helpers/socketAuth");

async function sendMessageWithRetry({ payload, socket, maxRetries = 3, attempt = 0 }) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const message = await sendMessage({
      conversationId: payload.conversationId,
      senderUserInfoId: socket.data.userInfoId,
      content: payload.content,
      type: payload.type,
      replyToMessageId: payload.replyToMessageId || null,
      mentions: payload.mentions || [],
      session
    });
    await session.commitTransaction();
    return message;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();

    const isTransient =
      error?.errorLabels?.includes("TransientTransactionError") || error?.code === 112;

    if (isTransient && attempt < maxRetries - 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50 * (attempt + 1));
      });
      return sendMessageWithRetry({ payload, socket, maxRetries, attempt: attempt + 1 });
    }

    throw error;
  } finally {
    session.endSession();
  }
}

async function emitConversationEventToMembers(io, conversationId, eventName, payload) {
  const conversation = await ConversationModel.findById(conversationId).select("members").lean();

  if (!conversation?.members?.length) return;

  const memberIds = conversation.members
    .map((member) => String(member?._id || member))
    .filter(Boolean);

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
    if (socket.data.accountId) {
      socket.join(`account:${socket.data.accountId}`);
    }

    onAuthed(socket, "chat:join", async (payload) => {
      const conversation = await getConversationDetail({
        conversationId: payload.conversationId,
        userInfoId: socket.data.userInfoId
      });
      socket.join(`conversation:${String(conversation._id)}`);
      return { data: conversation };
    });

    socket.on("chat:leave", (payload, callback) => {
      socket.leave(`conversation:${String(payload.conversationId)}`);
      ack(callback, { ok: true });
    });

    socket.on("chat:send", async (payload, callback) => {
      try {
        if (!socket.data.userInfoId) throw new ChatError("Bạn chưa xác thực socket", 401);

        const message = await sendMessageWithRetry({ payload, socket });

        ack(callback, { ok: true, data: message });

        io.to(`conversation:${String(payload.conversationId)}`).emit("message:new", {
          conversationId: String(payload.conversationId),
          message,
          clientMessageId: payload.clientMessageId ?? null
        });

        getConversationDetail({
          conversationId: payload.conversationId,
          userInfoId: socket.data.userInfoId
        })
          .then((conversation) =>
            Promise.all([
              emitConversationEventToMembers(io, payload.conversationId, "conversation:upserted", {
                conversation
              }),
              sendChatMessageNotification({
                io,
                conversationId: payload.conversationId,
                senderUserInfoId: socket.data.userInfoId,
                senderName: socket.data.userInfo?.full_name,
                message,
                conversation
              })
            ])
          )
          .catch((err) => console.error("[chat:send] post-processing error:", err));
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });

    onAuthed(socket, "chat:seen", async (payload) => {
      const result = await markConversationSeen({
        conversationId: payload.conversationId,
        userInfoId: socket.data.userInfoId
      });

      await emitConversationEventToMembers(io, payload.conversationId, "message:seen", {
        conversationId: String(payload.conversationId),
        userInfoId: String(socket.data.userInfoId)
      });

      return { data: result };
    });

    onAuthed(socket, "chat:deleteConversation", async (payload) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) throw new ChatError("Thiếu conversationId", 400);

      const result = await deleteConversation({
        conversationId,
        userInfoId: socket.data.userInfoId
      });

      await emitConversationEventToMembers(io, conversationId, "conversation:deleted", {
        conversationId: String(conversationId)
      });

      return { data: result };
    });

    onAuthed(socket, "chat:deleteMessage", async (payload) => {
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

      getConversationDetail({
        conversationId,
        userInfoId: socket.data.userInfoId
      })
        .then((conversation) =>
          emitConversationEventToMembers(io, conversationId, "conversation:upserted", {
            conversation
          })
        )
        .catch((err) => console.error("[chat:deleteMessage] post-processing error:", err));

      return { data: result };
    });

    onAuthed(socket, "chat:react", async (payload) => {
      const { conversationId, messageId, type } = payload;
      const { message, action } = await reactToMessage({
        conversationId,
        messageId,
        userInfoId: socket.data.userInfoId,
        type
      });

      io.to(`conversation:${String(conversationId)}`).emit("message:reaction", {
        conversationId: String(conversationId),
        message,
        action
      });

      return { data: { message, action } };
    });
  });
};

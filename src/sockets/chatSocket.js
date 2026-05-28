const jwt = require("jsonwebtoken");
const AccountModel = require("../models/AccountModel");
const ConversationModel = require("../models/ConversationModel");
const UserInfoModel = require("../models/UserInfoModel");
const { sendChatMessageNotification } = require("../helpers/chatNotification");
const {
  ChatError,
  getConversationDetail,
  sendMessage,
  markConversationSeen,
} = require("../services/chatService");

async function resolveSocketUser(socket) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(" ")[1] ||
    socket.handshake.query?.token;

  if (!token) return null;

  const decoded = jwt.verify(token, process.env.SECRET_KEY);
  const account = await AccountModel.findById(decoded.id).lean();
  if (!account || account.isDeleted) return null;

  const userInfo = await UserInfoModel.findOne({
    id_account: account._id,
    isDeleted: false,
  })
    .select("full_name avatar ma_nv id_account")
    .lean();

  if (!userInfo) return null;

  return {
    accountId: String(account._id),
    userInfo,
  };
}

function ack(ackFn, payload) {
  if (typeof ackFn === "function") {
    ackFn(payload);
  }
}

async function emitConversationEventToMembers(
  io,
  conversationId,
  eventName,
  payload,
) {
  const conversation = await ConversationModel.findById(conversationId)
    .select("members")
    .lean();

  if (!conversation?.members?.length) return;

  const memberIds = conversation.members
    .map((member) => String(member?._id || member))
    .filter((memberId) => memberId);

  memberIds.forEach((memberId) => {
    io.to(`user:${memberId}`).emit(eventName, payload);
  });
}

module.exports = function setupChatSocket(io) {
  io.on("connection", async (socket) => {
    try {
      // Khi socket vừa kết nối, đọc token từ handshake để gắn user đang online vào socket.
      const auth = await resolveSocketUser(socket);
      if (auth?.userInfo?._id) {
        socket.data.accountId = auth.accountId;
        socket.data.userInfoId = String(auth.userInfo._id);
        socket.data.userInfo = auth.userInfo;
        // Room user:{userInfoId} dùng để push event riêng cho từng người dùng.
        socket.join(`user:${String(auth.userInfo._id)}`);
      }
    } catch (error) {
      console.error("chatSocket auth error:", error.message);
    }

    socket.on("chat:join", async (payload = {}, callback) => {
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        // Kiểm tra quyền truy cập conversation trước khi cho join room.
        const conversation = await getConversationDetail({
          conversationId: payload.conversationId,
          userInfoId: socket.data.userInfoId,
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
      try {
        if (!socket.data.userInfoId) {
          throw new ChatError("Bạn chưa xác thực socket", 401);
        }

        // Service sẽ validate quyền truy cập, kiểm tra type/content và lưu message vào DB.
        const message = await sendMessage({
          conversationId: payload.conversationId,
          senderUserInfoId: socket.data.userInfoId,
          content: payload.content,
          type: payload.type,
        });

        // Phát event cho toàn bộ room của conversation để mọi client đang mở chat nhận tin nhắn mới.
        io.to(`conversation:${String(payload.conversationId)}`).emit(
          "message:new",
          {
            conversationId: String(payload.conversationId),
            message,
            clientMessageId: payload.clientMessageId ?? null,
          },
        );

        // Phát thêm theo từng member để đảm bảo mọi thiết bị của cùng user đều nhận được update.
        await emitConversationEventToMembers(
          io,
          payload.conversationId,
          "message:new",
          {
            conversationId: String(payload.conversationId),
            message,
            clientMessageId: payload.clientMessageId ?? null,
          },
        );

        // Push notification là lớp bổ sung cho user offline hoặc đang ở tab khác.
        await sendChatMessageNotification({
          conversationId: payload.conversationId,
          senderUserInfoId: socket.data.userInfoId,
          senderName: socket.data.userInfo?.full_name,
          message,
        });

        ack(callback, { ok: true, data: message });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
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
          userInfoId: socket.data.userInfoId,
        });

        // Báo ngược lại cho cả room conversation để các client cập nhật trạng thái seen.
        io.to(`conversation:${String(payload.conversationId)}`).emit(
          "message:seen",
          {
            conversationId: String(payload.conversationId),
            userInfoId: String(socket.data.userInfoId),
          },
        );

        await emitConversationEventToMembers(
          io,
          payload.conversationId,
          "message:seen",
          {
            conversationId: String(payload.conversationId),
            userInfoId: String(socket.data.userInfoId),
          },
        );

        ack(callback, { ok: true, data: result });
      } catch (error) {
        ack(callback, { ok: false, message: error.message });
      }
    });
  });
};

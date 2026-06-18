class ChatError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ChatError";
    this.statusCode = statusCode;
  }
}

function handleChatError(res, error) {
  if (error instanceof ChatError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return res.status(500).json({
    message: "Internal server error",
    error: error.message
  });
}

function ack(ackFn, payload) {
  if (typeof ackFn === "function") ackFn(payload);
}

function onAuthed(socket, event, handler) {
  socket.on(event, async (payload, cb) => {
    try {
      if (!socket.data.userInfoId) throw new ChatError("Bạn chưa xác thực socket", 401);
      const data = await handler(payload, socket);
      ack(cb, { ok: true, ...data });
    } catch (error) {
      ack(cb, { ok: false, message: error.message });
    }
  });
}

module.exports = { ack, onAuthed, ChatError, handleChatError };

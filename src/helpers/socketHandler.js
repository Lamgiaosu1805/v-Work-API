class ChatError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ChatError";
    this.statusCode = statusCode;
  }
}

function handleChatError(res, error) {
  if (error instanceof ChatError) {
    console.warn(`[ChatError] ${error.statusCode} - ${error.message}`);
    return res.status(error.statusCode).json({ message: error.message });
  }

  console.error("[UnhandledError]", error);
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
    const userInfoId = socket.data.userInfoId;

    try {
      if (!userInfoId) throw new ChatError("Bạn chưa xác thực socket", 401);
      const data = await handler(payload, socket);
      ack(cb, { ok: true, ...data });
    } catch (error) {
      if (error instanceof ChatError) {
        console.warn(
          `[Socket:${event}] user=${userInfoId ?? "unknown"} - ${error.statusCode} ${error.message}`
        );
      } else {
        console.error(
          `[Socket:${event}] user=${userInfoId ?? "unknown"} - Unhandled error:`,
          error
        );
      }

      ack(cb, {
        ok: false,
        message: error instanceof ChatError ? error.message : "Đã có lỗi xảy ra",
        ...(process.env.NODE_ENV !== "production" &&
          !(error instanceof ChatError) && { stack: error.stack })
      });
    }
  });
}

module.exports = { ack, onAuthed, ChatError, handleChatError };

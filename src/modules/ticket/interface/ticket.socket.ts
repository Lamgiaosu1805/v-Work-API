import mongoose from "mongoose";
import type { Server, Socket } from "socket.io";
import { logger } from "../../../config/logger";
import { TicketWatchAuthorizer } from "../application/ports";
import { TicketWatchService } from "../application/ticket-watch.service";
import {
  MAX_WATCHED_TICKETS_PER_SOCKET,
  TICKET_SOCKET_EVENTS,
  ticketRoom
} from "../infrastructure/ticket-realtime";

type Ack = (payload: unknown) => void;

// Gọi ack ĐÚNG MỘT LẦN dù handler đi qua nhiều nhánh.
function onceAck(callback: unknown): Ack {
  let called = false;
  return (payload) => {
    if (called || typeof callback !== "function") return;
    called = true;
    callback(payload);
  };
}

function ticketIdOf(payload: unknown): string | null {
  const value = (payload as { ticketId?: unknown } | null | undefined)?.ticketId;
  const id = typeof value === "string" ? value : "";
  return mongoose.isValidObjectId(id) ? id : null;
}

function watchedCount(socket: Socket): number {
  return [...socket.rooms].filter((room) => room.startsWith("ticket:")).length;
}

// Đăng ký `ticket:watch` / `ticket:unwatch` cho mọi kết nối. Gọi SAU setupChatSocket (middleware xác thực của nó gắn
// `socket.data.userInfoId` trước khi các handler này chạy).
export function setupTicketSocket(
  io: Server,
  authorizer: TicketWatchAuthorizer = new TicketWatchService()
): void {
  io.on("connection", (socket) => {
    socket.on(TICKET_SOCKET_EVENTS.WATCH, async (payload: unknown, callback: unknown) => {
      const reply = onceAck(callback);
      try {
        const employeeId = socket.data.userInfoId as string | undefined;
        if (!employeeId) return reply({ ok: false, code: "unauthorized" });

        const ticketId = ticketIdOf(payload);
        if (!ticketId) return reply({ ok: false, code: "invalid_ticket" });

        const room = ticketRoom(ticketId);
        const alreadyIn = socket.rooms.has(room);
        if (!alreadyIn && watchedCount(socket) >= MAX_WATCHED_TICKETS_PER_SOCKET) {
          return reply({ ok: false, code: "too_many" });
        }

        // Không tồn tại và không có quyền trả chung một mã, không lộ sự có mặt của ticket hạn chế.
        if (!(await authorizer.canWatch(employeeId, ticketId))) {
          return reply({ ok: false, code: "forbidden" });
        }
        socket.join(room);
        return reply({ ok: true });
      } catch (error) {
        logger.error("Ticket realtime: lỗi khi theo dõi ticket", {
          error: error instanceof Error ? error.message : String(error)
        });
        return reply({ ok: false, code: "error" });
      }
    });

    socket.on(TICKET_SOCKET_EVENTS.UNWATCH, (payload: unknown, callback: unknown) => {
      const ticketId = ticketIdOf(payload);
      if (ticketId) socket.leave(ticketRoom(ticketId));
      onceAck(callback)({ ok: true });
    });
  });
}

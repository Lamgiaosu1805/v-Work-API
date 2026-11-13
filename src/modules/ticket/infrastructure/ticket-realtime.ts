import { logger } from "../../../config/logger";
import { TicketChange, TicketRealtime, TicketWatchAuthorizer } from "../application/ports";

// getIO() nằm ở sockets/ioRegistry.js (JS, chưa migrate) — nạp bằng require như ticket-notifier.ts với notificationService.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getIO } = require("../../../sockets/ioRegistry");

// Kênh realtime của trang chi tiết ticket. Client vào phòng `ticket:<id>` bằng `ticket:watch` (server kiểm quyền xem),
// server báo `ticket:changed` khi ticket đổi và `ticket:revoked` (kèm đá khỏi phòng) khi người đang xem mất quyền.
export const TICKET_SOCKET_EVENTS = {
  WATCH: "ticket:watch",
  UNWATCH: "ticket:unwatch",
  CHANGED: "ticket:changed",
  REVOKED: "ticket:revoked"
} as const;

export const ticketRoom = (ticketId: string) => `ticket:${ticketId}`;

// Một socket của người dùng chỉ được theo dõi tối đa chừng này ticket cùng lúc (chặn lạm dụng tạo phòng).
export const MAX_WATCHED_TICKETS_PER_SOCKET = 20;

interface SocketLike {
  id: string;
  data: { userInfoId?: string };
  leave(room: string): unknown;
  emit(event: string, payload: unknown): unknown;
}

export class SocketIoTicketRealtime implements TicketRealtime {
  constructor(private readonly authorizer: TicketWatchAuthorizer) {}

  publishChanged(change: TicketChange): void {
    try {
      const io = getIO();
      if (!io) return;
      this.dispatch(io, change).catch((error) => {
        logger.error("Không phát được tín hiệu realtime của ticket", {
          error,
          ticketId: change.ticketId
        });
      });
    } catch (error) {
      logger.error("Không phát được tín hiệu realtime của ticket", {
        error,
        ticketId: change.ticketId
      });
    }
  }

  private async dispatch(io: any, change: TicketChange): Promise<void> {
    const room = ticketRoom(change.ticketId);
    // Phòng trống thì khỏi tốn công kiểm quyền / phát (đa số ticket không có ai đang mở).
    const sockets: SocketLike[] = await io.in(room).fetchSockets();
    if (!sockets.length) return;

    // Chỉ thay đổi ticket mới có thể làm ai đó mất quyền xem; tin nhắn mới thì không.
    if (change.kind === "updated") {
      await this.revokeLostAccess(room, change.ticketId, sockets);
    }

    io.to(room).emit(TICKET_SOCKET_EVENTS.CHANGED, {
      ticketId: change.ticketId,
      kind: change.kind,
      version: change.version ?? null,
      actorId: change.actorId
    });
  }

  // Người mất quyền xem bị đá khỏi phòng TRƯỚC khi phát `ticket:changed`, để họ không nhận thêm tín hiệu nào về ticket.
  private async revokeLostAccess(
    room: string,
    ticketId: string,
    sockets: SocketLike[]
  ): Promise<void> {
    const employeeIds = sockets.map((socket) => socket.data.userInfoId).filter(Boolean) as string[];
    const lost = await this.authorizer.lostAccess(ticketId, employeeIds);
    sockets.forEach((socket) => {
      const employeeId = socket.data.userInfoId;
      // Socket chưa xác thực không thể vào phòng; nếu lọt vào cũng đá ra.
      if (employeeId && !lost.has(employeeId)) return;
      socket.leave(room);
      socket.emit(TICKET_SOCKET_EVENTS.REVOKED, { ticketId });
    });
  }
}

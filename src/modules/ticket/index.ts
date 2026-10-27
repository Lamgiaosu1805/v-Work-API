// Public API của module ticket — chỉ export những gì nơi khác (workflows/, jobs/, routes/) cần dùng.
// KHÔNG export domain Entity / Repository (xem CLAUDE.md "DDD + Hexagonal").
export { TicketSweepService } from "./application/ticket-sweep.service";
export type { TicketSweepResult } from "./application/ticket-sweep.service";

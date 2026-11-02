// Public API của module ticket — chỉ export những gì nơi khác (workflows/, jobs/, routes/) cần dùng.
// KHÔNG export domain Entity / Repository (xem CLAUDE.md "DDD + Hexagonal").
export { TicketSweepService } from "./application/ticket-sweep.service";
export type { TicketSweepResult } from "./application/ticket-sweep.service";
export { getTicketGuideText } from "./application/ticket-guide-summary.service";
export {
  describeOwnTickets,
  normalizeTicketCodes,
  MAX_ASSISTANT_TICKET_CODES
} from "./application/ticket-assistant-brief.service";
export type {
  OwnTicketBrief,
  OwnTicketsBriefResult
} from "./application/ticket-assistant-brief.service";

import TicketActivityModel from "../../../models/TicketActivityModel";
import { RequestContextService } from "../../../core/context/request-context";
import { TicketActivityDraft } from "../domain/types";

// Nhật ký ticket — chỉ ghi thêm. Chạy cùng transaction với lệnh ghi ticket (session lấy từ
// AsyncLocalStorage, giống MongooseRepositoryBase).
export class TicketActivityRepository {
  // eslint-disable-next-line class-methods-use-this
  async append(ticketId: string, drafts: TicketActivityDraft[]): Promise<void> {
    if (!drafts.length) return;
    const session = RequestContextService.getTransactionSession() as any;
    await TicketActivityModel.create(
      drafts.map((draft) => ({
        ticket_id: ticketId,
        actor_id: draft.actorId,
        action: draft.action,
        from: draft.from ?? null,
        to: draft.to ?? null,
        changes: draft.changes ?? [],
        note: draft.note ?? ""
      })),
      // Model.create(array) với session bắt buộc dạng { session } + ordered
      { session: session ?? undefined, ordered: true }
    );
  }
}

import TicketSecretModel from "../../../models/TicketSecretModel";
import { RequestContextService } from "../../../core/context/request-context";
import { TicketSecretStore } from "../application/ports";
import { encryptSecret } from "./ticket-secret-crypto";

// Lưu nội dung ẩn đã mã hoá. Chạy cùng transaction với tin nhắn (session lấy từ AsyncLocalStorage).
export class TicketSecretRepository implements TicketSecretStore {
  // eslint-disable-next-line class-methods-use-this
  async createMany(input: {
    ticketId: string;
    messageId: string | null;
    authorId: string;
    secrets: Array<{ id: string; label: string; value: string }>;
  }): Promise<void> {
    if (!input.secrets.length) return;
    const session = (RequestContextService.getTransactionSession() as any) ?? undefined;
    await TicketSecretModel.create(
      input.secrets.map((secret) => ({
        _id: secret.id,
        ticket_id: input.ticketId,
        message_id: input.messageId ?? null,
        author_id: input.authorId,
        label: secret.label,
        ...encryptSecret(secret.value, input.ticketId)
      })),
      { session, ordered: true }
    );
  }
}

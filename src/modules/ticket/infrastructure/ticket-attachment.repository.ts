import TicketAttachmentModel from "../../../models/TicketAttachmentModel";
import { RequestContextService } from "../../../core/context/request-context";

export interface NewAttachment {
  ticketId: string;
  messageId?: string | null;
  kind: string;
  sensitive: boolean;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
}

const session = () => (RequestContextService.getTransactionSession() as any) ?? null;

export class TicketAttachmentRepository {
  // eslint-disable-next-line class-methods-use-this
  async createMany(items: NewAttachment[]): Promise<string[]> {
    if (!items.length) return [];
    const docs = await TicketAttachmentModel.create(
      items.map((item) => ({
        ticket_id: item.ticketId,
        message_id: item.messageId ?? null,
        kind: item.kind,
        sensitive: item.sensitive,
        original_name: item.originalName,
        stored_name: item.storedName,
        mime_type: item.mimeType,
        size: item.size,
        uploaded_by: item.uploadedBy
      })),
      { session: session() ?? undefined, ordered: true }
    );
    return docs.map((doc) => String(doc._id));
  }

  // Đã có file loại `kind` do `uploadedBy` tải lên SAU mốc `since` (vd tờ trình mới sau lần bị trả về).
  // Chỉ tính file của chính người bổ sung — file người khác gửi trong khung trao đổi không thay được tờ trình.
  // eslint-disable-next-line class-methods-use-this
  async hasKindSince(
    ticketId: string,
    kind: string,
    since: Date | null,
    uploadedBy?: string
  ): Promise<boolean> {
    const filter: Record<string, unknown> = { ticket_id: ticketId, kind, isDeleted: false };
    if (since) filter.createdAt = { $gt: since };
    if (uploadedBy) filter.uploaded_by = uploadedBy;
    const found = await TicketAttachmentModel.exists(filter).session(session());
    return Boolean(found);
  }
}

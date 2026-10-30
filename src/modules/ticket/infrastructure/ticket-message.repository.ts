import TicketMessageModel from "../../../models/TicketMessageModel";
import { RequestContextService } from "../../../core/context/request-context";

export interface NewMessage {
  ticketId: string;
  authorId: string;
  body: string;
  mentionIds: string[];
}

export class TicketMessageRepository {
  // eslint-disable-next-line class-methods-use-this
  async create(message: NewMessage): Promise<string> {
    const session = (RequestContextService.getTransactionSession() as any) ?? undefined;
    const [doc] = await TicketMessageModel.create(
      [
        {
          ticket_id: message.ticketId,
          author_id: message.authorId,
          body: message.body,
          mention_ids: message.mentionIds
        }
      ],
      { session }
    );
    return String(doc._id);
  }
}

import TicketModel from "../../../models/TicketModel";
import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import { ticketMapper } from "./ticket.mapper";
import { TicketEntity } from "../domain/ticket.entity";
import { TicketNotFoundError, TicketVersionConflictError } from "../domain/ticket.errors";

export class TicketRepository extends MongooseRepositoryBase<TicketEntity, any> {
  constructor() {
    super(TicketModel, ticketMapper);
  }

  async findOneByCode(code: string): Promise<TicketEntity | null> {
    const doc = await this.model
      .findOne({ code, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  // Ghi có kiểm tra version (optimistic concurrency). Hai người cùng sửa/nhận 1 ticket: người lưu sau
  // đọc phải version cũ nên điều kiện lọc không khớp → TicketVersionConflictError, không bao giờ ghi đè
  // âm thầm. Trả về entity mới với version đã tăng.
  async save(entity: TicketEntity): Promise<TicketEntity> {
    entity.validate();
    const { _id, ...record } = this.mapper.toPersistence(entity);
    const expectedVersion = entity.version;

    const doc = await this.model
      .findOneAndUpdate(
        { _id: entity.id, isDeleted: false, version: expectedVersion },
        { $set: { ...record, version: expectedVersion + 1 } },
        { session: this.session ?? null, new: true }
      )
      .lean();

    if (doc) return this.mapper.toDomain(doc);

    const exists = await this.model
      .exists({ _id: entity.id, isDeleted: false })
      .session(this.session ?? null);
    if (!exists) throw new TicketNotFoundError();
    throw new TicketVersionConflictError(undefined, {
      metadata: { ticketId: entity.id, expectedVersion }
    });
  }
}

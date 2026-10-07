import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import CustomerAssignmentModel from "../../../models/CustomerAssignmentModel";
import { CustomerAssignmentEntity } from "../domain/customer-assignment.entity";
import { customerAssignmentMapper } from "./customer-assignment.mapper";

export class CustomerAssignmentRepository extends MongooseRepositoryBase<
  CustomerAssignmentEntity,
  any
> {
  constructor() {
    super(CustomerAssignmentModel, customerAssignmentMapper);
  }

  async findActiveByCustomer(customerId: string): Promise<CustomerAssignmentEntity | null> {
    const doc = await this.model
      .findOne({ customer_id: customerId, status: "active", isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findActiveBySale(saleId: string): Promise<CustomerAssignmentEntity[]> {
    const docs = await this.model
      .find({ sale_id: saleId, status: "active", isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }

  /** Lượt giao đang hiệu lực đã tới một mốc cần xử lý (cảnh báo/thu hồi) tại `now`. */
  async findDueForSweep(now: Date, limit: number): Promise<CustomerAssignmentEntity[]> {
    const docs = await this.model
      .find({
        status: "active",
        isDeleted: false,
        $or: [
          { first_contact_at: null, warned_at: null, warn_at: { $lte: now } },
          { first_contact_at: null, auto_revoke: true, revoke_at: { $lte: now } },
          {
            first_contact_at: { $ne: null },
            inactivity_due_at: { $lte: now },
            $or: [{ auto_revoke: true }, { inactivity_warned_at: null }]
          }
        ]
      })
      .sort({ assigned_at: 1 })
      .limit(limit)
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }
}

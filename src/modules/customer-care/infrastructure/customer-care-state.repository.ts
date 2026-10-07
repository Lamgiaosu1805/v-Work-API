import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import CustomerCareStateModel from "../../../models/CustomerCareStateModel";
import { CustomerCareStateEntity } from "../domain/customer-care-state.entity";
import { customerCareStateMapper } from "./customer-care-state.mapper";

export class CustomerCareStateRepository extends MongooseRepositoryBase<
  CustomerCareStateEntity,
  any
> {
  constructor() {
    super(CustomerCareStateModel, customerCareStateMapper);
  }

  async findByCustomer(customerId: string): Promise<CustomerCareStateEntity | null> {
    const doc = await this.model
      .findOne({ customer_id: customerId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  /** Khách trong Pool theo thứ tự phân: ưu tiên thường trước ưu tiên thấp, nhóm A trước B, vào Pool sớm trước. */
  async findPoolQueue(appId: string, limit: number): Promise<CustomerCareStateEntity[]> {
    const docs = await this.model
      .find({ app_id: appId, pool_status: "in_pool", isDeleted: false })
      .sort({ low_priority: 1, priority_class: 1, entered_pool_at: 1 })
      .limit(limit)
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }
}

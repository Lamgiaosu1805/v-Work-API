import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import CustomerCallStatsModel from "../../../models/CustomerCallStatsModel";
import { CustomerCallStatsEntity } from "../domain/customer-call-stats.entity";
import { customerCallStatsMapper } from "./customer-call-stats.mapper";

export class CustomerCallStatsRepository extends MongooseRepositoryBase<
  CustomerCallStatsEntity,
  any
> {
  constructor() {
    super(CustomerCallStatsModel, customerCallStatsMapper);
  }

  async findByCustomerId(customerId: string): Promise<CustomerCallStatsEntity | null> {
    const doc = await this.model
      .findOne({ customer_id: customerId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }
}

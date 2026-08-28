import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import CallLogModel from "../../../models/CallLogModel";
import { CallLogEntity } from "../domain/call-log.entity";
import { callLogMapper } from "./call-log.mapper";

export class CallLogRepository extends MongooseRepositoryBase<CallLogEntity, any> {
  constructor() {
    super(CallLogModel, callLogMapper);
  }

  async findByTransactionId(transactionId: string): Promise<CallLogEntity | null> {
    const doc = await this.model
      .findOne({ transaction_id: transactionId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }
}

import {
  CustomerCallStatsEntity,
  CustomerCallStatsProps
} from "../domain/customer-call-stats.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const customerCallStatsMapper: Mapper<CustomerCallStatsEntity, any> = {
  toDomain(record) {
    return new CustomerCallStatsEntity(
      {
        id: String(record._id),
        props: {
          customerId: String(record.customer_id),
          callCount: record.call_count,
          lastContactedAt: record.last_contacted_at ?? null
        } as CustomerCallStatsProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const props = entity.getProps();
    return {
      _id: props.id,
      customer_id: props.customerId,
      call_count: props.callCount,
      last_contacted_at: props.lastContactedAt
    };
  }
};

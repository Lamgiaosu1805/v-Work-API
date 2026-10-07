import { Mapper } from "../../../core/db/mongoose-repository.base";
import {
  CustomerCareStateEntity,
  CustomerCareStateProps
} from "../domain/customer-care-state.entity";

export const customerCareStateMapper: Mapper<CustomerCareStateEntity, any> = {
  toDomain(record) {
    return new CustomerCareStateEntity(
      {
        id: String(record._id),
        props: {
          customerId: String(record.customer_id),
          appId: String(record.app_id),
          poolStatus: record.pool_status,
          priorityClass: record.priority_class,
          roundCount: record.round_count ?? 0,
          currentAssignmentId: record.current_assignment_id
            ? String(record.current_assignment_id)
            : null,
          currentSaleId: record.current_sale_id ? String(record.current_sale_id) : null,
          previousSaleIds: (record.previous_sale_ids ?? []).map(String),
          enteredPoolAt: record.entered_pool_at ?? null,
          convertedAt: record.converted_at ?? null,
          statusReason: record.status_reason ?? null,
          lowPriority: !!record.low_priority
        } as CustomerCareStateProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const p = entity.getProps();
    return {
      _id: p.id,
      customer_id: p.customerId,
      app_id: p.appId,
      pool_status: p.poolStatus,
      priority_class: p.priorityClass,
      round_count: p.roundCount,
      current_assignment_id: p.currentAssignmentId,
      current_sale_id: p.currentSaleId,
      previous_sale_ids: p.previousSaleIds,
      entered_pool_at: p.enteredPoolAt,
      converted_at: p.convertedAt,
      status_reason: p.statusReason,
      low_priority: p.lowPriority
    };
  }
};

import { Mapper } from "../../../core/db/mongoose-repository.base";
import {
  CustomerAssignmentEntity,
  CustomerAssignmentProps
} from "../domain/customer-assignment.entity";

const idOrNull = (value: unknown): string | null => (value ? String(value) : null);

export const customerAssignmentMapper: Mapper<CustomerAssignmentEntity, any> = {
  toDomain(record) {
    return new CustomerAssignmentEntity(
      {
        id: String(record._id),
        props: {
          customerId: String(record.customer_id),
          appId: String(record.app_id),
          saleId: String(record.sale_id),
          round: record.round,
          channel: record.channel,
          priorityClass: record.priority_class,
          assignedAt: record.assigned_at,
          assignedBy: idOrNull(record.assigned_by),
          autoRevoke: record.auto_revoke !== false,
          firstContactDueAt: record.first_contact_due_at,
          warnAt: record.warn_at,
          revokeAt: record.revoke_at,
          inactivityDueAt: record.inactivity_due_at,
          firstContactAt: record.first_contact_at ?? null,
          firstContactBreached: !!record.first_contact_breached,
          lastValidActivityAt: record.last_valid_activity_at ?? null,
          attemptCount: record.attempt_count ?? 0,
          attemptsSinceValid: record.attempts_since_valid ?? 0,
          warnedAt: record.warned_at ?? null,
          inactivityWarnedAt: record.inactivity_warned_at ?? null,
          appointmentAt: record.appointment_at ?? null,
          status: record.status,
          endedAt: record.ended_at ?? null,
          endedReason: record.ended_reason ?? null,
          endedBy: idOrNull(record.ended_by),
          endNote: record.end_note ?? null
        } as CustomerAssignmentProps,
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
      sale_id: p.saleId,
      round: p.round,
      channel: p.channel,
      priority_class: p.priorityClass,
      assigned_at: p.assignedAt,
      assigned_by: p.assignedBy,
      auto_revoke: p.autoRevoke,
      first_contact_due_at: p.firstContactDueAt,
      warn_at: p.warnAt,
      revoke_at: p.revokeAt,
      inactivity_due_at: p.inactivityDueAt,
      first_contact_at: p.firstContactAt,
      first_contact_breached: p.firstContactBreached,
      last_valid_activity_at: p.lastValidActivityAt,
      attempt_count: p.attemptCount,
      attempts_since_valid: p.attemptsSinceValid,
      warned_at: p.warnedAt,
      inactivity_warned_at: p.inactivityWarnedAt,
      appointment_at: p.appointmentAt,
      status: p.status,
      ended_at: p.endedAt,
      ended_reason: p.endedReason,
      ended_by: p.endedBy,
      end_note: p.endNote
    };
  }
};

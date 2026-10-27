import { Mapper } from "../../../core/db/mongoose-repository.base";
import { TicketEntity } from "../domain/ticket.entity";
import { TicketProps } from "../domain/types";

// Mongoose doc (snake_case) <-> TicketEntity (camelCase). Id người dùng/phòng ban lưu ObjectId, trong
// domain là string.

const str = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const strList = (values: unknown): string[] => ((values as unknown[]) ?? []).map(String);

export const ticketMapper: Mapper<TicketEntity, any> = {
  toDomain(doc) {
    const props: TicketProps = {
      code: doc.code,
      title: doc.title,
      description: doc.description ?? "",
      productId: String(doc.product_id),
      categoryId: String(doc.category_id),
      templateId: str(doc.template_id),
      customFields: doc.custom_fields ?? {},
      urgency: doc.urgency,
      customer: doc.customer
        ? {
            customerId: str(doc.customer.customer_id),
            appCode: doc.customer.app_code ?? null,
            phone: doc.customer.phone ?? null,
            name: doc.customer.name ?? null,
            externalId: doc.customer.external_id ?? null
          }
        : null,
      createdBy: String(doc.created_by),
      assignment: {
        mode: doc.assignment?.mode ?? "none",
        departmentId: str(doc.assignment?.department_id),
        memberIds: strList(doc.assignment?.member_ids),
        assignedBy: str(doc.assignment?.assigned_by),
        ownerId: str(doc.assignment?.owner_id),
        collaboratorIds: strList(doc.assignment?.collaborator_ids),
        claimedAt: doc.assignment?.claimed_at ?? null
      },
      status: doc.status,
      resolution: doc.resolution
        ? {
            code: doc.resolution.code,
            note: doc.resolution.note ?? "",
            actionTaken: doc.resolution.action_taken ?? "",
            by: str(doc.resolution.by),
            at: doc.resolution.at
          }
        : null,
      followUp: doc.follow_up
        ? { note: doc.follow_up.note ?? "", checkAt: doc.follow_up.check_at ?? null }
        : null,
      hold: doc.hold
        ? { reason: doc.hold.reason ?? "", resumeAt: doc.hold.resume_at ?? null }
        : null,
      infoRequest: doc.info_request
        ? {
            items: (doc.info_request.items ?? []).map((item: any) => ({
              key: item.key,
              label: item.label,
              note: item.note ?? "",
              fulfilled: Boolean(item.fulfilled)
            })),
            note: doc.info_request.note ?? "",
            requestedBy: str(doc.info_request.requested_by),
            requestedAt: doc.info_request.requested_at
          }
        : null,
      approval: {
        required: Boolean(doc.approval?.required),
        source: doc.approval?.source ?? null,
        mode: doc.approval?.mode ?? "document",
        status: doc.approval?.status ?? "not_required",
        reference: doc.approval?.reference
          ? {
              number: doc.approval.reference.number ?? "",
              date: doc.approval.reference.date ?? null,
              signer: doc.approval.reference.signer ?? ""
            }
          : null,
        verifiedBy: str(doc.approval?.verified_by),
        verifiedAt: doc.approval?.verified_at ?? null,
        note: doc.approval?.note ?? ""
      },
      visibility: doc.visibility ?? "normal",
      relatedTicketIds: strList(doc.related_ticket_ids),
      duplicateOf: str(doc.duplicate_of),
      dueHintAt: doc.due_hint_at ?? null,
      rescheduleCount: doc.reschedule_count ?? 0,
      lastActivityAt: doc.last_activity_at,
      statusChangedAt: doc.status_changed_at,
      alertAt: doc.alert_at ?? null,
      alertReason: doc.alert_reason ?? null,
      autoCloseAt: doc.auto_close_at ?? null,
      remindAt: doc.remind_at ?? null,
      reminderSentAt: doc.reminder_sent_at ?? null,
      confirmedByRequester: Boolean(doc.confirmed_by_requester),
      closedAt: doc.closed_at ?? null,
      reopenUntil: doc.reopen_until ?? null,
      reopenCount: doc.reopen_count ?? 0,
      version: doc.version ?? 0
    };

    return new TicketEntity(
      {
        id: String(doc._id),
        props,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        isDeleted: doc.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const p = entity.getProps();
    return {
      _id: p.id,
      code: p.code,
      title: p.title,
      description: p.description,
      product_id: p.productId,
      category_id: p.categoryId,
      template_id: p.templateId,
      custom_fields: p.customFields,
      urgency: p.urgency,
      customer: p.customer
        ? {
            customer_id: p.customer.customerId,
            app_code: p.customer.appCode,
            phone: p.customer.phone,
            name: p.customer.name,
            external_id: p.customer.externalId
          }
        : null,
      created_by: p.createdBy,
      assignment: {
        mode: p.assignment.mode,
        department_id: p.assignment.departmentId,
        member_ids: p.assignment.memberIds,
        assigned_by: p.assignment.assignedBy,
        owner_id: p.assignment.ownerId,
        collaborator_ids: p.assignment.collaboratorIds,
        claimed_at: p.assignment.claimedAt
      },
      status: p.status,
      resolution: p.resolution
        ? {
            code: p.resolution.code,
            note: p.resolution.note,
            action_taken: p.resolution.actionTaken,
            by: p.resolution.by,
            at: p.resolution.at
          }
        : null,
      follow_up: p.followUp ? { note: p.followUp.note, check_at: p.followUp.checkAt } : null,
      hold: p.hold ? { reason: p.hold.reason, resume_at: p.hold.resumeAt } : null,
      info_request: p.infoRequest
        ? {
            items: p.infoRequest.items,
            note: p.infoRequest.note,
            requested_by: p.infoRequest.requestedBy,
            requested_at: p.infoRequest.requestedAt
          }
        : null,
      approval: {
        required: p.approval.required,
        source: p.approval.source,
        mode: p.approval.mode,
        status: p.approval.status,
        reference: p.approval.reference,
        verified_by: p.approval.verifiedBy,
        verified_at: p.approval.verifiedAt,
        note: p.approval.note
      },
      visibility: p.visibility,
      related_ticket_ids: p.relatedTicketIds,
      duplicate_of: p.duplicateOf,
      due_hint_at: p.dueHintAt,
      reschedule_count: p.rescheduleCount,
      last_activity_at: p.lastActivityAt,
      status_changed_at: p.statusChangedAt,
      alert_at: p.alertAt,
      alert_reason: p.alertReason,
      auto_close_at: p.autoCloseAt,
      remind_at: p.remindAt,
      reminder_sent_at: p.reminderSentAt,
      confirmed_by_requester: p.confirmedByRequester,
      closed_at: p.closedAt,
      reopen_until: p.reopenUntil,
      reopen_count: p.reopenCount,
      version: p.version,
      isDeleted: p.isDeleted
    };
  }
};

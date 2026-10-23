import mongoose from "mongoose";
import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import {
  TicketAlreadyClaimedError,
  TicketApprovalRequiredError,
  TicketForbiddenError,
  TicketInvalidTransitionError,
  TicketNoteRequiredError,
  TicketNotEligibleError,
  TicketReopenNotAllowedError
} from "./ticket.errors";
import {
  TicketApprovalVerifiedDomainEvent,
  TicketAssignedDomainEvent,
  TicketClaimedDomainEvent,
  TicketCollaboratorAddedDomainEvent,
  TicketContentEditedDomainEvent,
  TicketCreatedDomainEvent,
  TicketInfoRequestedDomainEvent,
  TicketInfoSubmittedDomainEvent,
  TicketStatusChangedDomainEvent
} from "./events/ticket.domain-events";
import { isEligibleToClaim } from "./ticket-access";
import {
  AlertReason,
  ApprovalStatus,
  AssignmentMode,
  InfoRequestItem,
  RESOLUTIONS_REQUIRING_NOTE,
  TICKET_STATUSES,
  TicketActivityDraft,
  TicketApprovalReference,
  TicketAssignment,
  TicketCustomerSnapshot,
  TicketFollowUp,
  TicketProps,
  TicketResolution,
  TicketResolutionCode,
  TicketStatus,
  TicketUrgency
} from "./types";

// Khoá cố định của mục "Tờ trình" trong checklist yêu cầu bổ sung.
export const APPROVAL_DOCUMENT_ITEM_KEY = "approval_document";

const EDITABLE_STATUSES: TicketStatus[] = ["open", "in_progress", "waiting_info", "on_hold"];

export interface AssignmentInput {
  mode: AssignmentMode;
  departmentId?: string | null;
  memberIds?: string[];
  // Chủ trì chọn sẵn (phải nằm trong memberIds); bỏ trống thì người đầu tiên bấm "Nhận" là chủ trì.
  ownerId?: string | null;
  assignedBy?: string | null;
}

export interface CreateTicketInput {
  code: string;
  title: string;
  description?: string;
  productId: string;
  categoryId: string;
  templateId?: string | null;
  customFields?: Record<string, unknown>;
  urgency?: TicketUrgency;
  customer?: Partial<TicketCustomerSnapshot> | null;
  createdBy: string;
  approvalRequired?: boolean;
  // Người tạo đã đính kèm tờ trình ngay lúc tạo.
  approvalDocumentProvided?: boolean;
  approvalReference?: TicketApprovalReference | null;
  restricted?: boolean;
  assignment?: AssignmentInput | null;
  relatedTicketIds?: string[];
}

export interface InfoRequestInput {
  items: Array<{ key: string; label: string; note?: string }>;
  note?: string;
  requestedBy: string | null;
}

export interface ResolveInput {
  note?: string;
  actionTaken?: string;
  followUp?: { note: string; checkAt?: Date | null } | null;
  by: string;
}

export interface CloseInput {
  code: TicketResolutionCode;
  note?: string;
  actionTaken?: string;
  duplicateOf?: string | null;
  by: string;
  reopenUntil: Date | null;
}

export type EditScope = "requester" | "group";

export interface EditPatch {
  title?: string;
  description?: string;
  productId?: string;
  categoryId?: string;
  urgency?: TicketUrgency;
  customer?: Partial<TicketCustomerSnapshot> | null;
  customFields?: Record<string, unknown>;
}

const REQUESTER_EDITABLE: Array<keyof EditPatch> = [
  "title",
  "description",
  "productId",
  "categoryId",
  "urgency",
  "customer",
  "customFields"
];
const GROUP_EDITABLE: Array<keyof EditPatch> = ["productId", "categoryId", "urgency"];

function assertNote(note: string | undefined): void {
  if (!note || !note.trim()) throw new TicketNoteRequiredError();
}

function initialApprovalStatus(required: boolean, documentProvided: boolean): ApprovalStatus {
  if (!required) return "not_required";
  return documentProvided ? "submitted" : "missing";
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map(String))];
}

function sameId(a: unknown, b: unknown): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

function normalizeCustomer(
  customer?: Partial<TicketCustomerSnapshot> | null
): TicketCustomerSnapshot | null {
  if (!customer) return null;
  const snapshot: TicketCustomerSnapshot = {
    customerId: customer.customerId ? String(customer.customerId) : null,
    appCode: customer.appCode ?? null,
    phone: customer.phone ?? null,
    name: customer.name ?? null,
    externalId: customer.externalId ?? null
  };
  const hasAny = Object.values(snapshot).some((value) => value !== null && value !== "");
  return hasAny ? snapshot : null;
}

export class TicketEntity extends AggregateRoot<TicketProps> {
  private _activities: TicketActivityDraft[] = [];

  static create(input: CreateTicketInput, now: Date = new Date()): TicketEntity {
    const title = (input.title ?? "").trim();
    if (!title) throw new ArgumentInvalidException("Tiêu đề ticket không được để trống");

    const id = new mongoose.Types.ObjectId().toString();
    const assignment = TicketEntity._buildAssignment(input.assignment, now);
    const approvalRequired = Boolean(input.approvalRequired);
    const documentProvided = approvalRequired && Boolean(input.approvalDocumentProvided);
    const needsDocument = approvalRequired && !documentProvided;

    const hasOwner = Boolean(assignment.ownerId);
    // Ticket thiếu tờ trình bắt buộc thì quay về cho người tạo bổ sung ngay.
    let status: TicketStatus = hasOwner ? "in_progress" : "open";
    if (needsDocument) status = "waiting_info";

    const ticket = new TicketEntity({
      id,
      props: {
        code: input.code,
        title,
        description: (input.description ?? "").trim(),
        productId: String(input.productId),
        categoryId: String(input.categoryId),
        templateId: input.templateId ? String(input.templateId) : null,
        customFields: input.customFields ?? {},
        urgency: input.urgency ?? "normal",
        customer: normalizeCustomer(input.customer),
        createdBy: String(input.createdBy),
        assignment,
        status,
        resolution: null,
        followUp: null,
        hold: null,
        infoRequest: needsDocument
          ? {
              items: [
                {
                  key: APPROVAL_DOCUMENT_ITEM_KEY,
                  label: "Tờ trình có chữ ký",
                  note: "",
                  fulfilled: false
                }
              ],
              note: "",
              requestedBy: null,
              requestedAt: now
            }
          : null,
        approval: {
          required: approvalRequired,
          source: approvalRequired ? "template" : null,
          mode: "document",
          status: initialApprovalStatus(approvalRequired, documentProvided),
          reference: documentProvided ? (input.approvalReference ?? null) : null,
          verifiedBy: null,
          verifiedAt: null,
          note: ""
        },
        visibility: approvalRequired || input.restricted ? "restricted" : "normal",
        relatedTicketIds: uniq(input.relatedTicketIds ?? []),
        duplicateOf: null,
        dueHintAt: null,
        rescheduleCount: 0,
        lastActivityAt: now,
        statusChangedAt: now,
        alertAt: null,
        alertReason: null,
        autoCloseAt: null,
        remindAt: null,
        reminderSentAt: null,
        confirmedByRequester: false,
        closedAt: null,
        reopenUntil: null,
        reopenCount: 0,
        version: 0
      }
    });

    ticket._record({ action: "created", actorId: input.createdBy, to: status });
    ticket.addEvent(
      new TicketCreatedDomainEvent({
        aggregateId: id,
        actorId: input.createdBy,
        urgency: ticket.props.urgency
      })
    );
    if (assignment.mode !== "none") {
      ticket._record({
        action: "assigned",
        actorId: input.assignment?.assignedBy ?? input.createdBy,
        note: assignment.mode
      });
      ticket.addEvent(
        new TicketAssignedDomainEvent({
          aggregateId: id,
          actorId: assignment.assignedBy,
          mode: assignment.mode,
          departmentId: assignment.departmentId,
          memberIds: assignment.memberIds
        })
      );
    }
    return ticket;
  }

  // ---- getters -------------------------------------------------------------------------------

  get status(): TicketStatus {
    return this.props.status;
  }

  get code(): string {
    return this.props.code;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get ownerId(): string | null {
    return this.props.assignment.ownerId;
  }

  get version(): number {
    return this.props.version;
  }

  get approvalRequired(): boolean {
    return this.props.approval.required;
  }

  // Nhóm xử lý = chủ trì + người phối hợp.
  get handlerIds(): string[] {
    const { ownerId, collaboratorIds } = this.props.assignment;
    return uniq([...(ownerId ? [ownerId] : []), ...collaboratorIds]);
  }

  isRequester(employeeId: string): boolean {
    return sameId(this.props.createdBy, employeeId);
  }

  isHandler(employeeId: string): boolean {
    return this.handlerIds.some((id) => sameId(id, employeeId));
  }

  // Lấy các dòng nhật ký đã sinh ra từ lúc dựng entity; service ghi vào ticket_activity cùng transaction.
  pullActivities(): TicketActivityDraft[] {
    const activities = this._activities;
    this._activities = [];
    return activities;
  }

  // ---- nhận / giao việc ----------------------------------------------------------------------

  // Nhận xử lý. Hai người bấm cùng lúc: người sau thất bại ở bước lưu (version) — xem
  // TicketRepository.save — nên không bao giờ có 2 chủ trì.
  claim(employeeId: string, departmentIds: string[] = [], now: Date = new Date()): void {
    if (this.props.assignment.ownerId) {
      throw new TicketAlreadyClaimedError(undefined, {
        metadata: { ticketId: this.id, ownerId: this.props.assignment.ownerId }
      });
    }
    this._assertStatus(["open"]);
    this._assertEligibleToClaim(employeeId, departmentIds);

    const { assignment } = this.props;
    const collaboratorIds =
      assignment.mode === "members"
        ? assignment.memberIds.filter((id) => !sameId(id, employeeId))
        : assignment.collaboratorIds;

    this._mutate(
      {
        status: "in_progress",
        assignment: { ...assignment, ownerId: employeeId, collaboratorIds, claimedAt: now }
      },
      { action: "claimed", actorId: employeeId, from: "open", to: "in_progress" },
      now
    );
    this.addEvent(new TicketClaimedDomainEvent({ aggregateId: this.id, actorId: employeeId }));
  }

  // Giao việc (phân quyền ai được giao cho ai do tầng application kiểm tra).
  assign(input: AssignmentInput, now: Date = new Date()): void {
    this._assertStatus(["open", "in_progress", "waiting_info", "on_hold"]);
    const assignment = TicketEntity._buildAssignment(input, now);
    if (assignment.mode === "none") {
      throw new ArgumentInvalidException("Giao việc phải chọn phòng ban hoặc người cụ thể");
    }

    const from = this.props.status;
    let { status } = this.props;
    if (assignment.ownerId && status === "open") status = "in_progress";
    if (!assignment.ownerId && status === "in_progress") status = "open";

    this._mutate(
      { assignment, status },
      {
        action: "assigned",
        actorId: input.assignedBy ?? null,
        from,
        to: status,
        note: assignment.mode
      },
      now
    );
    this.addEvent(
      new TicketAssignedDomainEvent({
        aggregateId: this.id,
        actorId: input.assignedBy ?? null,
        mode: assignment.mode,
        departmentId: assignment.departmentId,
        memberIds: assignment.memberIds
      })
    );
  }

  // Chủ trì trả lại ticket: người phối hợp được thêm sớm nhất lên chủ trì, không còn ai thì về "open".
  release(employeeId: string, note: string, now: Date = new Date()): void {
    assertNote(note);
    this._assertStatus(["in_progress", "waiting_info", "on_hold"]);
    const { assignment } = this.props;
    if (!sameId(assignment.ownerId, employeeId)) {
      throw new TicketForbiddenError("Chỉ chủ trì mới trả lại được ticket");
    }

    const [nextOwner, ...rest] = assignment.collaboratorIds;
    const from = this.props.status;
    // Còn người phối hợp thì giữ trạng thái; hết người thì ticket đang xử lý quay về "open".
    const status: TicketStatus = !nextOwner && from === "in_progress" ? "open" : from;

    this._mutate(
      {
        status,
        assignment: {
          ...assignment,
          ownerId: nextOwner ?? null,
          collaboratorIds: rest,
          claimedAt: nextOwner ? assignment.claimedAt : null
        }
      },
      { action: "released", actorId: employeeId, from, to: status, note },
      now
    );
    if (status !== from) {
      this.addEvent(
        new TicketStatusChangedDomainEvent({
          aggregateId: this.id,
          actorId: employeeId,
          from,
          to: status
        })
      );
    }
  }

  addCollaborator(by: string, employeeId: string, now: Date = new Date()): void {
    this._assertStatus(["open", "in_progress", "waiting_info", "on_hold", "resolved"]);
    if (sameId(this.props.assignment.ownerId, employeeId) || this.isHandler(employeeId)) {
      throw new ArgumentInvalidException("Người này đã thuộc nhóm xử lý ticket");
    }
    const { assignment } = this.props;
    this._mutate(
      {
        assignment: { ...assignment, collaboratorIds: [...assignment.collaboratorIds, employeeId] }
      },
      { action: "collaborator_added", actorId: by, note: employeeId },
      now
    );
    this.addEvent(
      new TicketCollaboratorAddedDomainEvent({
        aggregateId: this.id,
        actorId: by,
        collaboratorId: employeeId
      })
    );
  }

  removeCollaborator(by: string, employeeId: string, now: Date = new Date()): void {
    const { assignment } = this.props;
    if (!assignment.collaboratorIds.some((id) => sameId(id, employeeId))) {
      throw new ArgumentInvalidException("Người này không phải người phối hợp của ticket");
    }
    this._mutate(
      {
        assignment: {
          ...assignment,
          collaboratorIds: assignment.collaboratorIds.filter((id) => !sameId(id, employeeId))
        }
      },
      { action: "collaborator_removed", actorId: by, note: employeeId },
      now
    );
  }

  // ---- yêu cầu bổ sung / tờ trình ------------------------------------------------------------

  requestInfo(input: InfoRequestInput, now: Date = new Date()): void {
    this._assertStatus(["open", "in_progress", "on_hold"]);
    if (!input.items.length) {
      throw new ArgumentInvalidException("Phải chọn ít nhất một mục cần bổ sung");
    }
    const items: InfoRequestItem[] = input.items.map((item) => ({
      key: item.key,
      label: item.label,
      note: item.note ?? "",
      fulfilled: false
    }));
    const asksApproval = items.some((item) => item.key === APPROVAL_DOCUMENT_ITEM_KEY);

    const from = this.props.status;
    const patch: Partial<TicketProps> = {
      status: "waiting_info",
      hold: null,
      infoRequest: {
        items,
        note: input.note ?? "",
        requestedBy: input.requestedBy,
        requestedAt: now
      }
    };
    if (asksApproval) {
      // Ticket cần tờ trình thì chuyển sang hạn chế kể từ lúc này (mục 5.1 của kế hoạch).
      patch.visibility = "restricted";
      patch.approval = {
        ...this.props.approval,
        required: true,
        source: this.props.approval.required ? this.props.approval.source : "handler",
        status: "missing",
        verifiedBy: null,
        verifiedAt: null
      };
    }

    this._mutate(
      patch,
      {
        action: "info_requested",
        actorId: input.requestedBy,
        from,
        to: "waiting_info",
        note: items.map((item) => item.label).join(", ")
      },
      now
    );
    this.addEvent(
      new TicketInfoRequestedDomainEvent({ aggregateId: this.id, actorId: input.requestedBy })
    );
  }

  // Người tạo bấm "Đã bổ sung". `approvalReference` có khi lần bổ sung này gồm file tờ trình.
  submitInfo(
    employeeId: string,
    options: {
      approvalSubmitted?: boolean;
      approvalReference?: TicketApprovalReference | null;
    } = {},
    now: Date = new Date()
  ): void {
    this._assertStatus(["waiting_info"]);
    if (!this.isRequester(employeeId)) {
      throw new TicketForbiddenError("Chỉ người tạo ticket mới bổ sung được thông tin");
    }
    const { infoRequest, approval } = this.props;
    const waitingForDocument = infoRequest?.items.some(
      (item) => item.key === APPROVAL_DOCUMENT_ITEM_KEY && !item.fulfilled
    );
    if (waitingForDocument && !options.approvalSubmitted) {
      throw new ArgumentInvalidException("Vui lòng tải lên tờ trình có chữ ký trước khi gửi");
    }

    const patch: Partial<TicketProps> = {
      status: this.props.assignment.ownerId ? "in_progress" : "open",
      infoRequest: null
    };
    if (waitingForDocument) {
      patch.approval = {
        ...approval,
        status: "submitted",
        reference: options.approvalReference ?? approval.reference,
        verifiedBy: null,
        verifiedAt: null,
        note: ""
      };
    }
    this._mutate(
      patch,
      { action: "info_submitted", actorId: employeeId, from: "waiting_info", to: patch.status },
      now
    );
    this.addEvent(
      new TicketInfoSubmittedDomainEvent({ aggregateId: this.id, actorId: employeeId })
    );
  }

  // Xác nhận tờ trình hợp lệ / không hợp lệ. Không cho người tạo tự xác nhận ticket của mình.
  // [CHỜ-DUYỆT-ĐIỆN-TỬ] Chỉ áp cho approval.mode = "document"; mode "electronic" sẽ có lệnh duyệt/từ chối
  // theo từng cấp riêng (và trạng thái ticket "pending_approval") thay cho lệnh này.
  verifyApproval(by: string, valid: boolean, note = "", now: Date = new Date()): void {
    const { approval } = this.props;
    if (!approval.required || approval.status !== "submitted") {
      throw new TicketInvalidTransitionError("Ticket chưa có tờ trình nào đang chờ xác nhận");
    }
    this._assertStatus(["open", "in_progress", "on_hold"]);
    if (this.isRequester(by)) {
      throw new TicketForbiddenError("Người tạo ticket không được tự xác nhận tờ trình");
    }
    if (!valid) assertNote(note);

    if (valid) {
      this._mutate(
        {
          approval: { ...approval, status: "verified", verifiedBy: by, verifiedAt: now, note }
        },
        { action: "approval_verified", actorId: by, note },
        now
      );
    } else {
      const from = this.props.status;
      this._mutate(
        {
          status: "waiting_info",
          hold: null,
          approval: { ...approval, status: "invalid", verifiedBy: by, verifiedAt: now, note },
          infoRequest: {
            items: [
              {
                key: APPROVAL_DOCUMENT_ITEM_KEY,
                label: "Tờ trình có chữ ký",
                note,
                fulfilled: false
              }
            ],
            note,
            requestedBy: by,
            requestedAt: now
          }
        },
        { action: "approval_invalid", actorId: by, from, to: "waiting_info", note },
        now
      );
    }
    this.addEvent(
      new TicketApprovalVerifiedDomainEvent({ aggregateId: this.id, actorId: by, valid })
    );
  }

  // ---- trạng thái xử lý ----------------------------------------------------------------------

  hold(by: string, reason: string, resumeAt: Date | null = null, now: Date = new Date()): void {
    assertNote(reason);
    this._assertStatus(["in_progress"]);
    this._mutate(
      { status: "on_hold", hold: { reason: reason.trim(), resumeAt } },
      { action: "on_hold", actorId: by, from: "in_progress", to: "on_hold", note: reason },
      now
    );
    this._statusChanged(by, "in_progress", "on_hold");
  }

  resume(by: string, now: Date = new Date()): void {
    this._assertStatus(["on_hold"]);
    const to: TicketStatus = this.props.assignment.ownerId ? "in_progress" : "open";
    this._mutate(
      { status: to, hold: null },
      { action: "resumed", actorId: by, from: "on_hold", to },
      now
    );
    this._statusChanged(by, "on_hold", to);
  }

  // Báo đã xử lý xong, chờ người tạo xác nhận (tự đóng nếu không phản hồi).
  resolve(input: ResolveInput, now: Date = new Date()): void {
    this._assertStatus(["in_progress"]);
    this._assertApprovalPassed();

    const followUp: TicketFollowUp | null = input.followUp?.note?.trim()
      ? { note: input.followUp.note.trim(), checkAt: input.followUp.checkAt ?? null }
      : null;
    const resolution: TicketResolution = {
      code: "solved",
      note: (input.note ?? "").trim(),
      actionTaken: (input.actionTaken ?? "").trim(),
      by: input.by,
      at: now
    };
    this._mutate(
      { status: "resolved", resolution, followUp },
      {
        action: "resolved",
        actorId: input.by,
        from: "in_progress",
        to: "resolved",
        note: resolution.note
      },
      now
    );
    this._statusChanged(input.by, "in_progress", "resolved", "solved");
  }

  // Nhóm xử lý đóng ticket với một kết quả (kể cả "Đã giải quyết" khi tự kết luận luôn).
  close(input: CloseInput, now: Date = new Date()): void {
    if (input.code === "requester_no_response") {
      throw new ArgumentInvalidException("Kết quả này chỉ do hệ thống tự đặt");
    }
    this._assertStatus(["open", "in_progress", "waiting_info", "on_hold", "resolved"]);
    const note = (input.note ?? "").trim();
    if (RESOLUTIONS_REQUIRING_NOTE.includes(input.code) && !note) {
      throw new TicketNoteRequiredError("Vui lòng nhập lý do khi đóng ticket với kết quả này");
    }
    if (input.code === "duplicate" && !input.duplicateOf) {
      throw new ArgumentInvalidException("Ticket trùng phải chỉ rõ ticket gốc");
    }
    if (input.code === "solved") this._assertApprovalPassed();

    const from = this.props.status;
    this._mutate(
      {
        status: "closed",
        resolution: {
          code: input.code,
          note,
          actionTaken: (input.actionTaken ?? "").trim() || this.props.resolution?.actionTaken || "",
          by: input.by,
          at: now
        },
        duplicateOf: input.code === "duplicate" ? String(input.duplicateOf) : null,
        hold: null,
        infoRequest: null,
        closedAt: now,
        reopenUntil: input.reopenUntil,
        confirmedByRequester: false
      },
      { action: "closed", actorId: input.by, from, to: "closed", note: `${input.code}: ${note}` },
      now
    );
    this._statusChanged(input.by, from, "closed", input.code);
  }

  // Người tạo xác nhận đã xong → đóng và không mở lại được nữa.
  confirm(employeeId: string, now: Date = new Date()): void {
    this._assertStatus(["resolved"]);
    if (!this.isRequester(employeeId)) {
      throw new TicketForbiddenError("Chỉ người tạo ticket mới xác nhận được");
    }
    this._mutate(
      {
        status: "closed",
        confirmedByRequester: true,
        closedAt: now,
        reopenUntil: null
      },
      { action: "confirmed", actorId: employeeId, from: "resolved", to: "closed" },
      now
    );
    this._statusChanged(employeeId, "resolved", "closed", "solved");
  }

  // Hệ thống tự đóng (cron): resolved quá hạn → "Đã giải quyết"; waiting_info quá hạn → "Người tạo không bổ sung".
  autoClose(reopenUntil: Date | null, now: Date = new Date()): void {
    const from = this.props.status;
    if (from === "resolved") {
      this._mutate(
        { status: "closed", closedAt: now, reopenUntil, confirmedByRequester: false },
        { action: "auto_closed", actorId: null, from, to: "closed", note: "solved" },
        now
      );
      this._statusChanged(null, from, "closed", "solved");
      return;
    }
    if (from === "waiting_info") {
      this._mutate(
        {
          status: "closed",
          infoRequest: null,
          closedAt: now,
          reopenUntil,
          confirmedByRequester: false,
          resolution: {
            code: "requester_no_response",
            note: "Người tạo không bổ sung thông tin trong thời hạn",
            actionTaken: "",
            by: null,
            at: now
          }
        },
        { action: "auto_closed", actorId: null, from, to: "closed", note: "requester_no_response" },
        now
      );
      this._statusChanged(null, from, "closed", "requester_no_response");
      return;
    }
    throw new TicketInvalidTransitionError("Ticket không ở trạng thái có thể tự đóng");
  }

  // Mở lại: từ "resolved" thì không giới hạn; từ "closed" chỉ khi người tạo CHƯA xác nhận và còn hạn.
  reopen(by: string, note: string, now: Date = new Date()): void {
    assertNote(note);
    if (this.props.status === "cancelled") {
      throw new TicketReopenNotAllowedError("Ticket đã huỷ, vui lòng tạo ticket mới");
    }
    const from = this.props.status;
    if (from === "closed") {
      const { confirmedByRequester, reopenUntil } = this.props;
      if (confirmedByRequester || !reopenUntil || now.getTime() > reopenUntil.getTime()) {
        throw new TicketReopenNotAllowedError();
      }
    } else if (from !== "resolved") {
      throw new TicketInvalidTransitionError("Chỉ mở lại được ticket đã xử lý hoặc đã đóng");
    }
    if (!this.isRequester(by) && !this.isHandler(by)) {
      throw new TicketForbiddenError("Chỉ người tạo hoặc nhóm xử lý mới mở lại được ticket");
    }

    const to: TicketStatus = this.props.assignment.ownerId ? "in_progress" : "open";
    this._mutate(
      {
        status: to,
        resolution: null,
        followUp: null,
        closedAt: null,
        reopenUntil: null,
        duplicateOf: null,
        confirmedByRequester: false,
        reopenCount: this.props.reopenCount + 1
      },
      { action: "reopened", actorId: by, from, to, note },
      now
    );
    this._statusChanged(by, from, to);
  }

  // Người tạo rút yêu cầu trước khi xử lý xong.
  cancel(employeeId: string, note: string, now: Date = new Date()): void {
    assertNote(note);
    this._assertStatus(["open", "waiting_info"]);
    if (!this.isRequester(employeeId)) {
      throw new TicketForbiddenError("Chỉ người tạo ticket mới huỷ được");
    }
    const from = this.props.status;
    this._mutate(
      { status: "cancelled", infoRequest: null, closedAt: now, reopenUntil: null },
      { action: "cancelled", actorId: employeeId, from, to: "cancelled", note },
      now
    );
    this._statusChanged(employeeId, from, "cancelled");
  }

  // ---- sửa nội dung / liên kết ---------------------------------------------------------------

  // Trả về các thay đổi thực sự (rỗng = không có gì đổi, không ghi nhật ký).
  edit(
    patch: EditPatch,
    scope: EditScope,
    by: string,
    note = "",
    now: Date = new Date()
  ): Array<{ field: string; from: unknown; to: unknown }> {
    this._assertStatus(EDITABLE_STATUSES);
    const allowed = scope === "requester" ? REQUESTER_EDITABLE : GROUP_EDITABLE;
    const forbidden = (Object.keys(patch) as Array<keyof EditPatch>).filter(
      (key) => patch[key] !== undefined && !allowed.includes(key)
    );
    if (forbidden.length) {
      throw new TicketForbiddenError(`Không được sửa trường: ${forbidden.join(", ")}`);
    }

    const next: Partial<TicketProps> = {};
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    const track = <K extends keyof TicketProps>(field: K, value: TicketProps[K]) => {
      if (JSON.stringify(this.props[field]) !== JSON.stringify(value)) {
        changes.push({ field, from: this.props[field], to: value });
        next[field] = value;
      }
    };

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new ArgumentInvalidException("Tiêu đề ticket không được để trống");
      track("title", title);
    }
    if (patch.description !== undefined) track("description", patch.description.trim());
    if (patch.productId !== undefined) track("productId", String(patch.productId));
    if (patch.categoryId !== undefined) track("categoryId", String(patch.categoryId));
    if (patch.urgency !== undefined) track("urgency", patch.urgency);
    if (patch.customer !== undefined) track("customer", normalizeCustomer(patch.customer));
    if (patch.customFields !== undefined) track("customFields", patch.customFields);

    if (!changes.length) return [];
    if (scope === "group" && changes.some((change) => change.field === "urgency")) {
      assertNote(note);
    }

    this._mutate(next, { action: "edited", actorId: by, changes, note: note || undefined }, now);
    // Người tạo sửa sau khi đã có người nhận → báo chủ trì.
    if (scope === "requester" && this.props.assignment.ownerId) {
      this.addEvent(new TicketContentEditedDomainEvent({ aggregateId: this.id, actorId: by }));
    }
    return changes;
  }

  // Đặt/dời ngày dự kiến xong do nhóm xử lý tự hẹn. Dời ngày phải ghi lý do; số lần dời hiện trên ticket.
  setDueHint(by: string, dueHintAt: Date | null, reason = "", now: Date = new Date()): void {
    this._assertStatus(["open", "in_progress", "on_hold"]);
    const previous = this.props.dueHintAt;
    const changed = (previous?.getTime() ?? null) !== (dueHintAt?.getTime() ?? null);
    if (!changed) return;

    const rescheduled = previous !== null;
    if (rescheduled) assertNote(reason);
    this._mutate(
      {
        dueHintAt,
        rescheduleCount: rescheduled ? this.props.rescheduleCount + 1 : this.props.rescheduleCount
      },
      {
        action: "due_hint_set",
        actorId: by,
        changes: [{ field: "dueHintAt", from: previous, to: dueHintAt }],
        note: reason || undefined
      },
      now
    );
  }

  // Liên kết "Liên quan đến": mỗi ticket vẫn xử lý và đóng riêng.
  linkRelated(by: string, relatedTicketId: string, now: Date = new Date()): void {
    if (sameId(relatedTicketId, this.id)) {
      throw new ArgumentInvalidException("Không thể liên kết ticket với chính nó");
    }
    if (this.props.relatedTicketIds.some((id) => sameId(id, relatedTicketId))) return;
    this._mutate(
      { relatedTicketIds: [...this.props.relatedTicketIds, String(relatedTicketId)] },
      { action: "linked", actorId: by, note: relatedTicketId },
      now
    );
  }

  // Ghi nhận hoạt động (tin nhắn, file...) để cảnh báo "im lặng" tính lại từ đây.
  recordActivity(by: string, action: string, note?: string, now: Date = new Date()): void {
    this._mutate({}, { action, actorId: by, note }, now);
  }

  // Cron/service tính lại mốc cảnh báo + tự đóng sau mỗi thay đổi (xem ticket-schedule.ts).
  applySchedule(schedule: {
    alertAt: Date | null;
    alertReason: AlertReason | null;
    autoCloseAt: Date | null;
    remindAt: Date | null;
  }): void {
    this.props = { ...this.props, ...schedule };
  }

  // Đã nhắc xong mốc `remindAt` — không nhắc lại cho tới lần đổi trạng thái kế tiếp.
  markReminded(now: Date = new Date()): void {
    this.props = { ...this.props, remindAt: null, reminderSentAt: now };
  }

  // ---- bất biến ------------------------------------------------------------------------------

  validate(): void {
    if (!TICKET_STATUSES.includes(this.props.status)) {
      throw new ArgumentInvalidException(`Trạng thái ticket không hợp lệ: ${this.props.status}`);
    }
    const { assignment } = this.props;
    if (assignment.mode === "department" && !assignment.departmentId) {
      throw new ArgumentInvalidException("Giao cho phòng ban phải có phòng ban");
    }
    if (assignment.mode === "members" && !assignment.memberIds.length) {
      throw new ArgumentInvalidException("Giao cho người cụ thể phải có ít nhất một người");
    }
    if (
      assignment.ownerId &&
      assignment.collaboratorIds.some((id) => sameId(id, assignment.ownerId))
    ) {
      throw new ArgumentInvalidException("Chủ trì không thể đồng thời là người phối hợp");
    }
  }

  // ---- nội bộ --------------------------------------------------------------------------------

  private static _buildAssignment(
    input: AssignmentInput | null | undefined,
    now: Date
  ): TicketAssignment {
    const empty: TicketAssignment = {
      mode: "none",
      departmentId: null,
      memberIds: [],
      assignedBy: null,
      ownerId: null,
      collaboratorIds: [],
      claimedAt: null
    };
    if (!input || input.mode === "none") return empty;

    if (input.mode === "department") {
      if (!input.departmentId) {
        throw new ArgumentInvalidException("Giao cho phòng ban phải chọn phòng ban");
      }
      return {
        ...empty,
        mode: "department",
        departmentId: String(input.departmentId),
        assignedBy: input.assignedBy ?? null
      };
    }

    const memberIds = uniq(input.memberIds ?? []);
    if (!memberIds.length) {
      throw new ArgumentInvalidException("Giao cho người cụ thể phải chọn ít nhất một người");
    }
    const ownerId = input.ownerId ? String(input.ownerId) : null;
    if (ownerId && !memberIds.includes(ownerId)) {
      throw new ArgumentInvalidException("Chủ trì phải nằm trong danh sách người được giao");
    }
    return {
      ...empty,
      mode: "members",
      memberIds,
      assignedBy: input.assignedBy ?? null,
      ownerId,
      collaboratorIds: ownerId ? memberIds.filter((id) => id !== ownerId) : [],
      claimedAt: ownerId ? now : null
    };
  }

  private _assertEligibleToClaim(employeeId: string, departmentIds: string[]): void {
    const { assignment } = this.props;
    if (isEligibleToClaim(assignment, employeeId, departmentIds)) return;
    throw assignment.mode === "department"
      ? new TicketNotEligibleError("Ticket này đã được giao cho phòng ban khác")
      : new TicketNotEligibleError();
  }

  private _assertStatus(allowed: TicketStatus[]): void {
    if (!allowed.includes(this.props.status)) {
      throw new TicketInvalidTransitionError(
        `Ticket đang ở trạng thái "${this.props.status}", không thể thực hiện thao tác này`,
        { metadata: { ticketId: this.id, currentStatus: this.props.status } }
      );
    }
  }

  // Ticket cần tờ trình thì phải được xác nhận hợp lệ mới được kết luận "Đã giải quyết".
  // [CHỜ-DUYỆT-ĐIỆN-TỬ] Đây là "cổng duyệt" duy nhất: hiện chỉ biết mode "document" (tờ trình được xác
  // nhận hợp lệ). Khi có duyệt điện tử, tách thành ApprovalGate theo approval.mode — mode "electronic"
  // trả lời "đã đủ cấp duyệt chưa" (dùng lại chuỗi duyệt của module request) — và đổi các chỗ gọi hàm này.
  private _assertApprovalPassed(): void {
    const { approval } = this.props;
    if (approval.required && approval.status !== "verified") {
      throw new TicketApprovalRequiredError();
    }
  }

  private _statusChanged(
    actorId: string | null,
    from: TicketStatus,
    to: TicketStatus,
    resolutionCode: TicketResolutionCode | null = null
  ): void {
    this.addEvent(
      new TicketStatusChangedDomainEvent({
        aggregateId: this.id,
        actorId,
        from,
        to,
        resolutionCode
      })
    );
  }

  private _mutate(patch: Partial<TicketProps>, activity: TicketActivityDraft, now: Date): void {
    const statusChanged = patch.status !== undefined && patch.status !== this.props.status;
    this._setProps({
      ...patch,
      lastActivityAt: now,
      ...(statusChanged ? { statusChangedAt: now, reminderSentAt: null } : {})
    });
    this._record(activity);
  }

  private _record(activity: TicketActivityDraft): void {
    this._activities.push(activity);
  }
}

import mongoose from "mongoose";
import { ArgumentInvalidException, ConflictException } from "../../../core/exceptions/exceptions";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import { logger } from "../../../config/logger";
import {
  APPROVAL_DOCUMENT_ITEM_KEY,
  AssignmentInput,
  CloseInput,
  EditPatch,
  TicketEntity
} from "../domain/ticket.entity";
import {
  TicketAlreadyClaimedError,
  TicketForbiddenError,
  TicketInvalidTransitionError,
  TicketNotFoundError,
  TicketVersionConflictError
} from "../domain/ticket.errors";
import { canActAsHandler, accessLevel, isRequester } from "../domain/ticket-access";
import {
  DEFAULT_SENSITIVE_KINDS,
  INFO_REQUEST_CATALOG,
  OTHER_INFO_KEY
} from "../domain/ticket-catalog";
import { computeReopenUntil } from "../domain/ticket-schedule";
import {
  TicketActor,
  TicketCustomerSnapshot,
  TicketResolutionCode,
  TicketUrgency
} from "../domain/types";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { TicketActivityRepository } from "../infrastructure/ticket-activity.repository";
import { TicketAttachmentRepository } from "../infrastructure/ticket-attachment.repository";
import { TicketMessageRepository } from "../infrastructure/ticket-message.repository";
import { nextTicketCode } from "../infrastructure/ticket-code.generator";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { NotificationServiceTicketNotifier } from "../infrastructure/ticket-notifier";
import { MongooseSchedulerLoader } from "../infrastructure/ticket-scheduler.loader";
import { TicketConfigReader } from "./ticket-config.types";
import { TicketDirectory, TicketNotifier } from "./ports";
import { assertCanHandle, authorizeAssignment } from "./ticket-assignment-authorization";
import { recipientsWithTicketAccess } from "./ticket-recipient-access";
import { planMessageNotifications } from "./ticket-notification.policy";
import { resolveResponsibleIds } from "./ticket-responsible";
import { refreshSchedule, SchedulerLoader, TicketScheduler } from "./ticket-scheduling";
// Side-effect import (CLAUDE.md "Domain Event"): listener luôn sẵn sàng kể cả khi test gọi thẳng service.
import { registerTicketNotificationHandlers } from "./ticket-notification.handlers";

export interface UploadedTicketFile {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  // Loại giấy tờ: "approval_document", "cccd_images", "screenshot"... ("other" nếu không chọn)
  kind: string;
}

export interface CreateTicketCommand {
  title: string;
  description?: string;
  productId: string;
  categoryId?: string;
  templateId?: string | null;
  customFields?: Record<string, unknown>;
  urgency?: TicketUrgency;
  customer?: Partial<TicketCustomerSnapshot> | null;
  relatedEmployeeId?: string | null;
  assignment?: AssignmentInput | null;
  relatedTicketIds?: string[];
  approvalReference?: { number: string; date?: Date | null; signer?: string } | null;
}

export interface TicketCommandResult {
  id: string;
  code: string;
  status: string;
  version: number;
}

export interface TicketCommandDeps {
  tickets: TicketRepository;
  activities: TicketActivityRepository;
  attachments: TicketAttachmentRepository;
  messages: TicketMessageRepository;
  directory: TicketDirectory;
  config: TicketConfigReader;
  scheduler: SchedulerLoader;
  notifier: TicketNotifier;
  nextCode: (now: Date) => Promise<string>;
  now: () => Date;
}

export function createDefaultTicketDeps(): TicketCommandDeps {
  return {
    tickets: new TicketRepository(),
    activities: new TicketActivityRepository(),
    attachments: new TicketAttachmentRepository(),
    messages: new TicketMessageRepository(),
    directory: new MongooseTicketDirectory(),
    config: new MongooseTicketConfigReader(),
    scheduler: new MongooseSchedulerLoader(),
    notifier: new NotificationServiceTicketNotifier(),
    nextCode: nextTicketCode,
    now: () => new Date()
  };
}

interface Context {
  now: Date;
  scheduler: TicketScheduler;
}

interface ExecuteOptions {
  // Cho phép người tạo thao tác khi ticket hạn chế đã đóng (chỉ còn thấy thông tin chung) — vd mở lại.
  allowSummary?: boolean;
  // Thử lại khi trùng version (chỉ cho thao tác idempotent như ghi nhận hoạt động).
  retryOnConflict?: boolean;
  // Version ticket mà người dùng đang nhìn thấy trên màn hình. Lệch với bản đang lưu → ticket đã bị người khác
  // đổi sau khi họ mở trang, báo tải lại thay vì ghi đè. Không gửi thì bỏ qua kiểm tra (client cũ).
  expectedVersion?: number;
}

const MAX_CONFLICT_ATTEMPTS = 3;

function assertCanActAsHandler(ticket: TicketEntity, actor: TicketActor): void {
  if (!canActAsHandler(ticket.getProps(), actor)) {
    throw new TicketForbiddenError(
      "Chỉ nhóm xử lý (chủ trì, phối hợp) mới thực hiện được thao tác này"
    );
  }
}

// Xung đột ghi đồng thời: lệch version (optimistic) hoặc Mongo báo write-conflict trong transaction
// (đã được runInTransaction đổi thành ConflictException chung, code GENERIC.CONFLICT).
function isConcurrencyConflict(error: unknown): boolean {
  return (
    error instanceof TicketVersionConflictError ||
    (error instanceof ConflictException && error.code === "GENERIC.CONFLICT")
  );
}

const isEmptyValue = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && !value.trim());

export class TicketCommandService {
  constructor(private readonly deps: TicketCommandDeps = createDefaultTicketDeps()) {
    registerTicketNotificationHandlers();
  }

  // ---- tạo ticket ----------------------------------------------------------------------------

  async create(
    actor: TicketActor,
    cmd: CreateTicketCommand,
    files: UploadedTicketFile[] = []
  ): Promise<TicketCommandResult> {
    const now = this.deps.now();
    const { config } = this.deps;

    const product = await config.findProduct(String(cmd.productId));
    if (!product || !product.isActive) {
      throw new ArgumentInvalidException("Sản phẩm không hợp lệ");
    }
    const template = cmd.templateId ? await config.findTemplate(String(cmd.templateId)) : null;
    if (cmd.templateId && (!template || !template.isActive)) {
      throw new ArgumentInvalidException("Mẫu yêu cầu không hợp lệ");
    }
    const categoryId = template?.categoryId ?? cmd.categoryId;
    const category = categoryId ? await config.findCategory(String(categoryId)) : null;
    if (!category || !category.isActive) {
      throw new ArgumentInvalidException("Loại yêu cầu không hợp lệ");
    }

    const customFields = cmd.customFields ?? {};
    if (template) {
      // Trường gắn app_code (vd mã khoản vay chỉ cho VNFITE) chỉ bắt buộc với sản phẩm tương ứng.
      const missingFields = template.fields
        .filter(
          (field) =>
            field.required &&
            (!field.appCodes?.length ||
              (product.appCode && field.appCodes.includes(product.appCode))) &&
            isEmptyValue(customFields[field.key])
        )
        .map((field) => field.label);
      if (missingFields.length) {
        throw new ArgumentInvalidException(`Vui lòng nhập: ${missingFields.join(", ")}`);
      }
      // Tờ trình đi theo đường riêng (thiếu thì ticket quay về người tạo bổ sung) nên không chặn ở đây.
      const missingDocuments = template.requiredDocuments
        .filter(
          (item) =>
            item.required &&
            item.kind !== APPROVAL_DOCUMENT_ITEM_KEY &&
            !files.some((file) => file.kind === item.kind)
        )
        .map((item) => item.label);
      if (missingDocuments.length) {
        throw new ArgumentInvalidException(`Vui lòng đính kèm: ${missingDocuments.join(", ")}`);
      }
    }

    await authorizeAssignment(this.deps.directory, actor, cmd.assignment);

    let relatedEmployeeId: string | null = null;
    if (cmd.relatedEmployeeId) {
      const [employee] = mongoose.isValidObjectId(cmd.relatedEmployeeId)
        ? await this.deps.directory.getEmployees([String(cmd.relatedEmployeeId)])
        : [];
      if (!employee) throw new ArgumentInvalidException("Nhân sự liên quan không tồn tại");
      relatedEmployeeId = employee.id;
    }

    // Ticket liên quan khi tạo phải có thật và người tạo xem được (không liên kết tới ticket ẩn / không tồn tại)
    const relatedTicketIds = [...new Set((cmd.relatedTicketIds ?? []).map(String))];
    if (relatedTicketIds.length > 20) {
      throw new ArgumentInvalidException("Chỉ liên kết tối đa 20 ticket liên quan");
    }
    await this.assertTicketsVisible(actor, relatedTicketIds);

    const approvalRequired = Boolean(template?.requiresApproval);
    const code = await this.deps.nextCode(now);
    const ticket = TicketEntity.create(
      {
        code,
        title: cmd.title,
        description: cmd.description,
        productId: product.id,
        categoryId: category.id,
        templateId: template?.id ?? null,
        customFields,
        urgency: cmd.urgency ?? template?.defaultUrgency ?? "normal",
        customer: cmd.customer,
        relatedEmployeeId,
        createdBy: actor.employeeId,
        approvalRequired,
        approvalDocumentProvided: files.some((file) => file.kind === APPROVAL_DOCUMENT_ITEM_KEY),
        approvalReference: cmd.approvalReference
          ? {
              number: cmd.approvalReference.number,
              date: cmd.approvalReference.date ?? null,
              signer: cmd.approvalReference.signer ?? ""
            }
          : null,
        assignment: cmd.assignment ? { ...cmd.assignment, assignedBy: actor.employeeId } : null,
        relatedTicketIds
      },
      now
    );

    const scheduler = await this.deps.scheduler.load(now);
    refreshSchedule(ticket, scheduler);

    const sensitiveByTemplate = new Set(
      (template?.requiredDocuments ?? []).filter((item) => item.sensitive).map((item) => item.kind)
    );
    const activities = ticket.pullActivities();
    await runInTransaction(async () => {
      await this.deps.tickets.insert(ticket);
      await this.deps.activities.append(ticket.id, activities);
      await this.deps.attachments.createMany(
        files.map((file) => ({
          ticketId: ticket.id,
          kind: file.kind,
          sensitive:
            DEFAULT_SENSITIVE_KINDS.includes(file.kind) || sensitiveByTemplate.has(file.kind),
          originalName: file.originalName,
          storedName: file.storedName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedBy: actor.employeeId
        }))
      );
    });

    this.publish(ticket);
    return { id: ticket.id, code, status: ticket.status, version: 0 };
  }

  // ---- nhận / giao việc ----------------------------------------------------------------------

  async claim(actor: TicketActor, ticketId: string): Promise<TicketCommandResult> {
    try {
      return await this.execute(ticketId, actor, (ticket, { now }) =>
        ticket.claim(actor.employeeId, actor.departmentIds, now)
      );
    } catch (error) {
      // Hai người nhận cùng lúc: người lưu sau thua ở kiểm tra version → báo ai đã nhận.
      if (isConcurrencyConflict(error) || error instanceof TicketAlreadyClaimedError) {
        await this.throwAlreadyClaimed(ticketId);
      }
      throw error;
    }
  }

  release(actor: TicketActor, ticketId: string, note: string, expectedVersion?: number) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => ticket.release(actor.employeeId, note, now),
      { expectedVersion }
    );
  }

  async assign(
    actor: TicketActor,
    ticketId: string,
    input: AssignmentInput,
    expectedVersion?: number
  ) {
    await authorizeAssignment(this.deps.directory, actor, input);
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => ticket.assign({ ...input, assignedBy: actor.employeeId }, now),
      { expectedVersion }
    );
  }

  async addCollaborator(
    actor: TicketActor,
    ticketId: string,
    employeeId: string,
    expectedVersion?: number
  ) {
    const [employee] = await this.deps.directory.getEmployees([employeeId]);
    if (!employee) throw new ArgumentInvalidException("Nhân viên không tồn tại");
    await assertCanHandle(this.deps.directory, [employee], [employee.id]);
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.addCollaborator(actor.employeeId, employee.id, now);
      },
      { expectedVersion }
    );
  }

  removeCollaborator(
    actor: TicketActor,
    ticketId: string,
    employeeId: string,
    expectedVersion?: number
  ) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        const leavingSelf = employeeId === actor.employeeId;
        if (!leavingSelf) assertCanActAsHandler(ticket, actor);
        ticket.removeCollaborator(actor.employeeId, employeeId, now);
      },
      { expectedVersion }
    );
  }

  // ---- bổ sung thông tin / tờ trình ----------------------------------------------------------

  requestInfo(
    actor: TicketActor,
    ticketId: string,
    input: { items: Array<{ key: string; note?: string }>; note?: string },
    expectedVersion?: number
  ) {
    const items = input.items.map((item) => {
      const entry = INFO_REQUEST_CATALOG.find((catalogItem) => catalogItem.key === item.key);
      if (!entry) throw new ArgumentInvalidException(`Mục bổ sung không hợp lệ: ${item.key}`);
      if (item.key === OTHER_INFO_KEY && !item.note?.trim()) {
        throw new ArgumentInvalidException('Mục "Khác" phải ghi rõ cần bổ sung gì');
      }
      return { key: entry.key, label: entry.label, note: item.note };
    });
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.requestInfo({ items, note: input.note, requestedBy: actor.employeeId }, now);
      },
      { expectedVersion }
    );
  }

  async submitInfo(
    actor: TicketActor,
    ticketId: string,
    input: {
      approvalReference?: { number: string; date?: Date | null; signer?: string } | null;
      // Nội dung người tạo nhập để đáp lại yêu cầu (mô tả rõ hơn, mã khoản vay...): lưu thành tin nhắn trong
      // phần trao đổi để nhóm xử lý đọc ngay tại ticket.
      note?: string;
    },
    files: UploadedTicketFile[] = [],
    expectedVersion?: number
  ) {
    const note = (input.note ?? "").trim();
    let isSensitive: (kind: string) => boolean = (kind) => DEFAULT_SENSITIVE_KINDS.includes(kind);
    return this.execute(
      ticketId,
      actor,
      async (ticket, { now }) => {
        // Tính TRƯỚC khi submitInfo xoá checklist: file gửi để đáp lại yêu cầu giấy tờ nhạy cảm
        // (CCCD, chứng từ, tờ trình) luôn là nhạy cảm dù người dùng để loại là "Khác".
        isSensitive = await this.sensitivityRule(ticket.getProps());
        const requested = ticket.getProps().infoRequest;
        // Mục chỉ trả lời được bằng chữ (mô tả, mã khoản vay, SĐT...) thì bắt buộc có nội dung bổ sung — không chỉ
        // dựa vào web, vì API gọi thẳng vẫn phải bị chặn.
        const textItems = (requested?.items ?? []).filter(
          (item) =>
            !item.fulfilled &&
            INFO_REQUEST_CATALOG.find((entry) => entry.key === item.key)?.input === "text"
        );
        if (textItems.length && !note) {
          throw new ArgumentInvalidException(
            `Vui lòng nhập nội dung bổ sung: ${textItems.map((item) => item.label).join(", ")}`
          );
        }
        const approvalItem = requested?.items.find(
          (item) => item.key === APPROVAL_DOCUMENT_ITEM_KEY && !item.fulfilled
        );
        // Tờ trình mới = file tải lên sau lúc bị yêu cầu bổ sung (không dùng lại file của lần trước).
        const approvalSubmitted = Boolean(
          approvalItem &&
          (files.some((file) => file.kind === APPROVAL_DOCUMENT_ITEM_KEY) ||
            (await this.deps.attachments.hasKindSince(
              ticket.id,
              APPROVAL_DOCUMENT_ITEM_KEY,
              requested?.requestedAt ?? null,
              actor.employeeId
            )))
        );
        ticket.submitInfo(
          actor.employeeId,
          {
            approvalSubmitted,
            approvalReference: input.approvalReference
              ? {
                  number: input.approvalReference.number,
                  date: input.approvalReference.date ?? null,
                  signer: input.approvalReference.signer ?? ""
                }
              : null
          },
          now
        );
      },
      { expectedVersion },
      async (saved) => {
        if (note) {
          await this.deps.messages.create({
            ticketId: saved.id,
            authorId: actor.employeeId,
            body: note,
            mentionIds: []
          });
        }
        await this.deps.attachments.createMany(
          files.map((file) => ({
            ticketId: saved.id,
            kind: file.kind,
            sensitive: isSensitive(file.kind),
            originalName: file.originalName,
            storedName: file.storedName,
            mimeType: file.mimeType,
            size: file.size,
            uploadedBy: actor.employeeId
          }))
        );
      }
    );
  }

  verifyApproval(
    actor: TicketActor,
    ticketId: string,
    input: { valid: boolean; note?: string },
    expectedVersion?: number
  ) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        if (!canActAsHandler(ticket.getProps(), actor) && !actor.canViewRestricted) {
          throw new TicketForbiddenError("Bạn không có quyền xác nhận tờ trình của ticket này");
        }
        ticket.verifyApproval(actor.employeeId, input.valid, input.note, now);
      },
      { expectedVersion }
    );
  }

  // ---- trạng thái xử lý ----------------------------------------------------------------------

  hold(
    actor: TicketActor,
    ticketId: string,
    input: { reason: string; resumeAt?: Date | null },
    expectedVersion?: number
  ) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.hold(actor.employeeId, input.reason, input.resumeAt ?? null, now);
      },
      { expectedVersion }
    );
  }

  resume(actor: TicketActor, ticketId: string, expectedVersion?: number) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.resume(actor.employeeId, now);
      },
      { expectedVersion }
    );
  }

  resolve(
    actor: TicketActor,
    ticketId: string,
    input: {
      note?: string;
      actionTaken?: string;
      followUp?: { note: string; checkAt?: Date | null } | null;
    },
    expectedVersion?: number
  ) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.resolve({ ...input, by: actor.employeeId }, now);
      },
      { expectedVersion }
    );
  }

  async close(
    actor: TicketActor,
    ticketId: string,
    input: {
      code: TicketResolutionCode;
      note?: string;
      actionTaken?: string;
      duplicateOf?: string | null;
    },
    expectedVersion?: number
  ) {
    if (input.code === "duplicate") {
      await this.assertDuplicateTarget(actor, ticketId, input.duplicateOf);
    }
    return this.execute(
      ticketId,
      actor,
      (ticket, { now, scheduler }) => {
        assertCanActAsHandler(ticket, actor);
        const closeInput: CloseInput = {
          ...input,
          by: actor.employeeId,
          reopenUntil: computeReopenUntil(now, scheduler.policy, scheduler.calendar)
        };
        ticket.close(closeInput, now);
      },
      { expectedVersion }
    );
  }

  // Người tạo xác nhận đã xong (đóng, không mở lại được nữa).
  confirm(actor: TicketActor, ticketId: string, expectedVersion?: number) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => ticket.confirm(actor.employeeId, now),
      { expectedVersion }
    );
  }

  cancel(actor: TicketActor, ticketId: string, note: string, expectedVersion?: number) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => ticket.cancel(actor.employeeId, note, now),
      { expectedVersion }
    );
  }

  reopen(actor: TicketActor, ticketId: string, note: string, expectedVersion?: number) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => ticket.reopen(actor.employeeId, note, now),
      { allowSummary: true, expectedVersion }
    );
  }

  // ---- sửa nội dung / liên kết / ngày hẹn ----------------------------------------------------

  async edit(
    actor: TicketActor,
    ticketId: string,
    patch: EditPatch,
    note = "",
    expectedVersion?: number
  ) {
    const product = patch.productId
      ? await this.deps.config.findProduct(String(patch.productId))
      : null;
    if (patch.productId && !product) throw new ArgumentInvalidException("Sản phẩm không hợp lệ");
    const category = patch.categoryId
      ? await this.deps.config.findCategory(String(patch.categoryId))
      : null;
    if (patch.categoryId && !category) {
      throw new ArgumentInvalidException("Loại yêu cầu không hợp lệ");
    }
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        const props = ticket.getProps();
        // Đổi sang sản phẩm / loại đã tắt thì chặn (như lúc tạo); giữ nguyên giá trị cũ của ticket thì không sao.
        if (product && !product.isActive && String(patch.productId) !== props.productId) {
          throw new ArgumentInvalidException("Sản phẩm không hợp lệ");
        }
        if (category && !category.isActive && String(patch.categoryId) !== props.categoryId) {
          throw new ArgumentInvalidException("Loại yêu cầu không hợp lệ");
        }
        if (isRequester(props, actor)) {
          ticket.edit(patch, "requester", actor.employeeId, note, now);
        } else if (canActAsHandler(props, actor)) {
          ticket.edit(patch, "group", actor.employeeId, note, now);
        } else {
          throw new TicketForbiddenError("Bạn không có quyền sửa ticket này");
        }
      },
      { expectedVersion }
    );
  }

  setDueHint(
    actor: TicketActor,
    ticketId: string,
    input: { dueHintAt: Date | null; reason?: string },
    expectedVersion?: number
  ) {
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.setDueHint(actor.employeeId, input.dueHintAt, input.reason, now);
      },
      { expectedVersion }
    );
  }

  async linkRelated(
    actor: TicketActor,
    ticketId: string,
    relatedTicketId: string,
    expectedVersion?: number
  ) {
    if (!mongoose.isValidObjectId(relatedTicketId)) throw new TicketNotFoundError();
    const related = await this.deps.tickets.findOneById(relatedTicketId);
    // Không cho lộ ticket hạn chế mà người dùng không xem được.
    if (!related || accessLevel(related.getProps(), actor) === "none") {
      throw new TicketNotFoundError("Ticket liên quan không tồn tại");
    }
    return this.execute(
      ticketId,
      actor,
      (ticket, { now }) => {
        assertCanActAsHandler(ticket, actor);
        ticket.linkRelated(actor.employeeId, relatedTicketId, now);
      },
      { expectedVersion }
    );
  }

  // ---- trao đổi ------------------------------------------------------------------------------

  // Tin nhắn không sửa ticket (không tăng version) — trừ khi người nhóm xử lý nhắn: khi đó tính là hoạt
  // động để cảnh báo "im lặng" đếm lại. Requester nhắn không làm ticket "hết im lặng".
  async addMessage(
    actor: TicketActor,
    ticketId: string,
    input: { body?: string; mentionIds?: string[] },
    files: UploadedTicketFile[] = []
  ): Promise<{ messageId: string }> {
    const body = (input.body ?? "").trim();
    if (!body && !files.length) {
      throw new ArgumentInvalidException("Tin nhắn phải có nội dung hoặc file đính kèm");
    }
    const mentionIds = [...new Set((input.mentionIds ?? []).map(String))];
    if (mentionIds.length) {
      const mentioned = await this.deps.directory.getEmployees(mentionIds);
      if (mentioned.length !== mentionIds.length) {
        throw new ArgumentInvalidException("Có người được nhắc tên không tồn tại");
      }
    }

    const ticket = await this.load(ticketId, actor);
    const props = ticket.getProps();
    if (["closed", "cancelled"].includes(props.status)) {
      throw new TicketInvalidTransitionError("Ticket đã kết thúc, không thể trao đổi thêm");
    }
    const isSensitive = await this.sensitivityRule(props);

    let messageId = "";
    const persistMessage = async (savedId: string) => {
      messageId = await this.deps.messages.create({
        ticketId: savedId,
        authorId: actor.employeeId,
        body,
        mentionIds
      });
      await this.deps.attachments.createMany(
        files.map((file) => ({
          ticketId: savedId,
          messageId,
          kind: file.kind,
          sensitive: isSensitive(file.kind),
          originalName: file.originalName,
          storedName: file.storedName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedBy: actor.employeeId
        }))
      );
    };

    if (canActAsHandler(props, actor)) {
      await this.execute(
        ticketId,
        actor,
        (current, { now }) => current.recordActivity(actor.employeeId, "message", undefined, now),
        { retryOnConflict: true },
        (saved) => persistMessage(saved.id)
      );
    } else {
      await runInTransaction(() => persistMessage(ticket.id));
    }

    await this.notifyMessage(ticket.id, props, actor.employeeId, body, mentionIds);
    return { messageId };
  }

  // Báo tin nhắn mới (người nhận theo ticket-notification.policy.ts). Lỗi chỉ log: thông báo hỏng không được làm hỏng việc gửi tin nhắn đã lưu xong.
  private async notifyMessage(
    ticketId: string,
    props: ReturnType<TicketEntity["getProps"]>,
    authorId: string,
    body: string,
    mentionIds: string[]
  ): Promise<void> {
    try {
      const [author] = await this.deps.directory.getEmployees([authorId]);
      let responsibleIds: string[] = [];
      let departmentManagerId: string | null = null;
      if (!props.assignment.ownerId) {
        const [template, category, product, scheduler] = await Promise.all([
          props.templateId ? this.deps.config.findTemplate(props.templateId) : null,
          this.deps.config.findCategory(props.categoryId),
          this.deps.config.findProduct(props.productId),
          this.deps.scheduler.load(this.deps.now())
        ]);
        responsibleIds = resolveResponsibleIds(props.urgency, {
          templateIds: template?.handlerIds,
          categoryIds: category?.handlerIds,
          productIds: product?.handlerIds,
          defaultIds: scheduler.settings.defaultHandlerIds
        });
        if (props.assignment.mode === "department" && props.assignment.departmentId) {
          const [department] = await this.deps.directory.getDepartments([
            props.assignment.departmentId
          ]);
          departmentManagerId = department?.managerId ?? null;
        }
      }

      const planned = planMessageNotifications(
        {
          ticket: { id: ticketId, props },
          authorId,
          authorName: author?.fullName ?? "Một đồng nghiệp",
          body,
          mentionIds,
          responsibleIds,
          departmentManagerId
        },
        props.visibility === "restricted"
      );
      // Người được @nhắc / người phụ trách mà không mở được ticket thì không báo (tránh link chết và lộ nội dung)
      const allowed = await recipientsWithTicketAccess(
        this.deps.directory,
        props,
        planned.flatMap((item) => item.employeeIds),
        [departmentManagerId]
      );
      await Promise.all(
        planned
          .map((item) => ({
            ...item,
            employeeIds: item.employeeIds.filter((id) => allowed.has(id))
          }))
          .filter((item) => item.employeeIds.length > 0)
          .map((item) =>
            this.deps.notifier.notify({
              employeeIds: item.employeeIds,
              title: item.title,
              body: item.body,
              type: item.type,
              ticketId
            })
          )
      );
    } catch (error) {
      logger.error("Không gửi được thông báo tin nhắn ticket", { error, ticketId });
    }
  }

  // ---- nội bộ --------------------------------------------------------------------------------

  // File nhạy cảm do SERVER quyết định, không tin hoàn toàn loại giấy tờ client khai: nhạy cảm khi loại
  // thuộc danh mục mặc định hoặc được mẫu của ticket đánh dấu; và khi ticket đang chờ người tạo bổ sung
  // giấy tờ nhạy cảm thì mọi file gửi lên lúc đó đều coi là nhạy cảm (tránh CCCD bị lưu thành "Khác").
  private async sensitivityRule(props: ReturnType<TicketEntity["getProps"]>) {
    const template = props.templateId
      ? await this.deps.config.findTemplate(props.templateId)
      : null;
    const kinds = new Set<string>([
      ...DEFAULT_SENSITIVE_KINDS,
      ...(template?.requiredDocuments ?? [])
        .filter((item) => item.sensitive)
        .map((item) => item.kind)
    ]);
    const awaitingSensitive =
      props.status === "waiting_info" &&
      (props.infoRequest?.items ?? []).some((item) => !item.fulfilled && kinds.has(item.key));
    return (kind: string) => awaitingSensitive || kinds.has(kind);
  }

  private async load(
    ticketId: string,
    actor: TicketActor,
    allowSummary = false
  ): Promise<TicketEntity> {
    if (!mongoose.isValidObjectId(ticketId)) throw new TicketNotFoundError();
    const ticket = await this.deps.tickets.findOneById(ticketId);
    if (!ticket) throw new TicketNotFoundError();
    const level = accessLevel(ticket.getProps(), actor);
    // Không có quyền xem thì coi như không tồn tại, không lộ sự có mặt của ticket hạn chế.
    if (level === "none" || (level === "summary" && !allowSummary)) {
      throw new TicketNotFoundError();
    }
    return ticket;
  }

  // Nạp ticket → áp thay đổi (domain) → tính lại mốc cảnh báo → ghi (optimistic) + nhật ký trong 1
  // transaction → phát sự kiện sau commit.
  private async execute(
    ticketId: string,
    actor: TicketActor,
    mutate: (ticket: TicketEntity, ctx: Context) => void | Promise<void>,
    options: ExecuteOptions = {},
    inTransaction?: (saved: TicketEntity) => Promise<void>
  ): Promise<TicketCommandResult> {
    const attempts = options.retryOnConflict ? MAX_CONFLICT_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt += 1) {
      const now = this.deps.now();
      const scheduler = await this.deps.scheduler.load(now);
      const ticket = await this.load(ticketId, actor, options.allowSummary);
      if (options.expectedVersion !== undefined && ticket.version !== options.expectedVersion) {
        throw new TicketVersionConflictError();
      }
      await mutate(ticket, { now, scheduler });
      refreshSchedule(ticket, scheduler);

      const activities = ticket.pullActivities();
      try {
        const saved = await runInTransaction(async () => {
          const result = await this.deps.tickets.save(ticket);
          await this.deps.activities.append(ticket.id, activities);
          if (inTransaction) await inTransaction(result);
          return result;
        });
        this.publish(ticket);
        return { id: saved.id, code: saved.code, status: saved.status, version: saved.version };
      } catch (error) {
        if (!isConcurrencyConflict(error)) throw error;
        // Thua cuộc đua ghi: thử lại (nếu thao tác cho phép) hoặc báo người dùng tải lại.
        if (attempt >= attempts) throw new TicketVersionConflictError();
      }
    }
  }

  // Phát sự kiện sau khi đã commit, không chờ và không để lỗi handler làm hỏng kết quả của lệnh.
  // eslint-disable-next-line class-methods-use-this
  private publish(ticket: TicketEntity): void {
    ticket.publishEvents(eventBus).catch((error) => {
      logger.error("Lỗi khi xử lý sự kiện ticket", { error, ticketId: ticket.id });
    });
  }

  private async throwAlreadyClaimed(ticketId: string): Promise<never> {
    const current = await this.deps.tickets.findOneById(ticketId);
    const ownerId = current?.ownerId;
    if (!ownerId) throw new TicketVersionConflictError();
    const [owner] = await this.deps.directory.getEmployees([ownerId]);
    throw new TicketAlreadyClaimedError(
      `${owner?.fullName ?? "Người khác"} đã nhận xử lý ticket này`,
      { metadata: { ticketId, ownerId } }
    );
  }

  private async assertTicketsVisible(actor: TicketActor, ticketIds: string[]) {
    const found = await Promise.all(
      ticketIds.map(async (id) =>
        mongoose.isValidObjectId(id) ? this.deps.tickets.findOneById(id) : null
      )
    );
    if (found.some((ticket) => !ticket || accessLevel(ticket.getProps(), actor) === "none")) {
      throw new ArgumentInvalidException("Ticket liên quan không tồn tại");
    }
  }

  private async assertDuplicateTarget(
    actor: TicketActor,
    ticketId: string,
    duplicateOf?: string | null
  ) {
    if (!duplicateOf || !mongoose.isValidObjectId(duplicateOf)) {
      throw new ArgumentInvalidException("Ticket trùng phải chỉ rõ ticket gốc");
    }
    if (String(duplicateOf) === String(ticketId)) {
      throw new ArgumentInvalidException("Không thể đánh dấu trùng với chính nó");
    }
    const [current, original] = await Promise.all([
      this.deps.tickets.findOneById(ticketId),
      this.deps.tickets.findOneById(String(duplicateOf))
    ]);
    // Kiểm tra quyền xem ticket đang đóng TRƯỚC mọi kết luận về ticket gốc: nếu không, người không xem được ticket này
    // vẫn dò được ticket có tồn tại và có trùng SĐT khách hay không qua mã lỗi 400 / 404.
    if (!current || accessLevel(current.getProps(), actor) === "none") {
      throw new TicketNotFoundError();
    }
    // Ticket gốc hạn chế mà người đóng không xem được thì coi như không tồn tại (không lộ sự có mặt).
    if (!original || accessLevel(original.getProps(), actor) === "none") {
      throw new TicketNotFoundError("Ticket gốc không tồn tại");
    }

    // Cùng một lỗi nhưng khác khách thì phải xử lý riêng từng khách → không được đánh dấu "Trùng".
    const phoneA = current.getProps().customer?.phone;
    const phoneB = original.getProps().customer?.phone;
    if (phoneA && phoneB && phoneA !== phoneB) {
      throw new ArgumentInvalidException(
        'Hai ticket thuộc hai khách khác nhau nên không thể đánh dấu trùng. Dùng liên kết "Liên quan" để xử lý riêng từng khách'
      );
    }
  }
}

let defaultService: TicketCommandService | null = null;

// Service dùng chung cho controller; tạo lười để import module không kéo theo kết nối DB.
export function getTicketCommandService(): TicketCommandService {
  if (!defaultService) defaultService = new TicketCommandService();
  return defaultService;
}

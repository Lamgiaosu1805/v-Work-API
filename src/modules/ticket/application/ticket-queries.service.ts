import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import TicketActivityModel from "../../../models/TicketActivityModel";
import TicketAttachmentModel from "../../../models/TicketAttachmentModel";
import TicketMessageModel from "../../../models/TicketMessageModel";
import TicketModel from "../../../models/TicketModel";
import { getTicketDir } from "../../../middlewares/uploadTicket";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { parsePagination } from "../../../core/http/parse-pagination";
import { accessLevel, canViewSensitiveFiles, customerVisibility } from "../domain/ticket-access";
import { capabilitiesOf } from "../domain/ticket-capabilities";
import { INFO_REQUEST_CATALOG, RESOLUTION_LABELS } from "../domain/ticket-catalog";
import { isYellow } from "../domain/ticket-schedule";
import { TicketEntity } from "../domain/ticket.entity";
import { TicketNotFoundError } from "../domain/ticket.errors";
import { TicketActor, TicketProps } from "../domain/types";
import { ticketMapper } from "../infrastructure/ticket.mapper";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { loadTicketSettings } from "../infrastructure/ticket-settings";
import { TicketConfigReader } from "./ticket-config.types";
import { TicketDirectory } from "./ports";
import {
  buildListFilter,
  listSort,
  normalizeScope,
  tabFilter,
  TicketListQuery,
  visibilityFilter
} from "./ticket-query-filters";

// Phía ĐỌC (CQRS-lite, theo CLAUDE.md): query thẳng Mongoose, không dựng Entity để trả về.

type Props = ReturnType<TicketEntity["getProps"]>;

export interface TicketQueryDeps {
  directory: TicketDirectory;
  config: TicketConfigReader;
  now: () => Date;
}

async function findTicketDoc(ticketId: string) {
  if (!mongoose.isValidObjectId(ticketId)) throw new TicketNotFoundError();
  const doc = await TicketModel.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!doc) throw new TicketNotFoundError();
  return doc;
}

export class TicketQueryService {
  constructor(
    private readonly deps: TicketQueryDeps = {
      directory: new MongooseTicketDirectory(),
      config: new MongooseTicketConfigReader(),
      now: () => new Date()
    }
  ) {}

  // ---- danh sách ----------------------------------------------------------------------------

  async list(actor: TicketActor, query: TicketListQuery) {
    const now = this.deps.now();
    const { page, limit, skip } = parsePagination(query);
    // Tab "Ticket phòng ban" cần biết ai thuộc phòng của người xem (kể cả phòng con) — chỉ tra khi cần.
    const needsDepartmentTree =
      query.tab === "department" && normalizeScope(query.tab, query.scope) !== "waiting";
    const departmentEmployeeIds = needsDepartmentTree
      ? await this.deps.directory.getOwnDepartmentTreeEmployeeIds(actor.employeeId)
      : undefined;
    const filter = buildListFilter(query, actor, now, { departmentEmployeeIds });

    const [docs, total] = await Promise.all([
      TicketModel.find(filter)
        .sort(listSort(query.tab) as any)
        .skip(skip)
        .limit(limit)
        .lean(),
      TicketModel.countDocuments(filter)
    ]);
    const tickets = docs.map((doc) => ticketMapper.toDomain(doc).getProps());

    const [names, products, categories] = await Promise.all([
      this.employeeNames(
        tickets.flatMap((ticket) => [ticket.createdBy, ticket.assignment.ownerId])
      ),
      this.deps.config.listProducts(false),
      this.deps.config.listCategories(false)
    ]);
    const productName = new Map(products.map((item) => [item.id, item.name]));
    const categoryName = new Map(categories.map((item) => [item.id, item.name]));

    return {
      data: tickets.map((ticket) => ({
        id: ticket.id,
        code: ticket.code,
        title: ticket.title,
        status: ticket.status,
        urgency: ticket.urgency,
        product: { id: ticket.productId, name: productName.get(ticket.productId) ?? "" },
        category: { id: ticket.categoryId, name: categoryName.get(ticket.categoryId) ?? "" },
        // Danh sách không cần mã khách (userId) nên không trả cho ai
        customer: ticket.customer ? { ...ticket.customer, externalId: null } : null,
        createdBy: { id: ticket.createdBy, name: names.get(ticket.createdBy) ?? "" },
        owner: ticket.assignment.ownerId
          ? { id: ticket.assignment.ownerId, name: names.get(ticket.assignment.ownerId) ?? "" }
          : null,
        collaboratorCount: ticket.assignment.collaboratorIds.length,
        assignmentMode: ticket.assignment.mode,
        // Cảnh báo vàng: ai cũng thấy ticket bị bôi vàng (không gửi thông báo)
        yellow: isYellow(ticket, now)
          ? { reason: ticket.alertReason, since: ticket.alertAt }
          : null,
        approval: { required: ticket.approval.required, status: ticket.approval.status },
        restricted: ticket.visibility === "restricted",
        resolution: ticket.resolution
          ? { code: ticket.resolution.code, label: RESOLUTION_LABELS[ticket.resolution.code] }
          : null,
        dueHintAt: ticket.dueHintAt,
        createdAt: ticket.createdAt,
        lastActivityAt: ticket.lastActivityAt
      })),
      total,
      page,
      limit
    };
  }

  // Số ticket của từng tab để hiện badge — chỉ đếm phần CẦN HÀNH ĐỘNG: "my" đếm ticket đang mở,
  // "department" đếm ticket đã giao cho phòng và đang chờ nhận.
  async counts(actor: TicketActor): Promise<Record<string, number>> {
    const now = this.deps.now();
    const badges: Array<{ key: string; tab: string; scope?: string }> = [
      { key: "my", tab: "my", scope: "open" },
      { key: "needs_reply", tab: "needs_reply" },
      { key: "unclaimed", tab: "unclaimed" },
      { key: "department", tab: "department", scope: "waiting" },
      { key: "yellow", tab: "yellow" }
    ];
    const entries = await Promise.all(
      badges.map(
        async ({ key, tab, scope }) =>
          [
            key,
            await TicketModel.countDocuments(buildListFilter({ tab, scope }, actor, now))
          ] as const
      )
    );
    // `total`: số ticket KHÁC NHAU cần người dùng để ý — một ticket nằm ở nhiều tab chỉ đếm một lần (badge menu).
    const total = await TicketModel.countDocuments({
      $and: [
        { isDeleted: false },
        visibilityFilter(actor),
        { $or: badges.map(({ tab, scope }) => tabFilter({ tab, scope }, actor, now)) }
      ]
    });
    return { ...Object.fromEntries(entries), total };
  }

  // ---- chi tiết -----------------------------------------------------------------------------

  async getById(actor: TicketActor, ticketId: string) {
    const now = this.deps.now();
    const doc = await findTicketDoc(ticketId);
    const ticket = ticketMapper.toDomain(doc).getProps();
    const level = accessLevel(ticket, actor);
    if (level === "none") throw new TicketNotFoundError();

    const names = await this.employeeNames([ticket.createdBy, ticket.assignment.ownerId]);

    if (level === "summary") {
      // Ticket hạn chế đã đóng: người tạo chỉ còn thấy thông tin chung (mục 6.1)
      return {
        accessLevel: "summary" as const,
        id: ticket.id,
        code: ticket.code,
        title: ticket.title,
        status: ticket.status,
        createdBy: { id: ticket.createdBy, name: names.get(ticket.createdBy) ?? "" },
        createdAt: ticket.createdAt,
        closedAt: ticket.closedAt,
        resolution: ticket.resolution
          ? {
              code: ticket.resolution.code,
              label: RESOLUTION_LABELS[ticket.resolution.code],
              note: ticket.resolution.note
            }
          : null,
        capabilities: capabilitiesOf(ticket, actor, now),
        reopenUntil: ticket.reopenUntil
      };
    }

    const [messages, attachments, activities, products, categories, template] = await Promise.all([
      TicketMessageModel.find({ ticket_id: ticket.id, isDeleted: false })
        .sort({ createdAt: 1 })
        .lean(),
      TicketAttachmentModel.find({ ticket_id: ticket.id, isDeleted: false })
        .sort({ createdAt: 1 })
        .lean(),
      TicketActivityModel.find({ ticket_id: ticket.id }).sort({ createdAt: 1 }).lean(),
      this.deps.config.listProducts(false),
      this.deps.config.listCategories(false),
      ticket.templateId ? this.deps.config.findTemplate(ticket.templateId) : null
    ]);

    const peopleIds = [
      ...ticket.assignment.collaboratorIds,
      ...ticket.assignment.memberIds,
      ticket.assignment.assignedBy,
      ticket.approval.verifiedBy,
      ...messages.flatMap((message: any) => [message.author_id, ...(message.mention_ids ?? [])]),
      ...attachments.map((file: any) => file.uploaded_by),
      ...activities.map((activity: any) => activity.actor_id)
    ];
    const allNames = await this.employeeNames([
      ...peopleIds,
      ticket.createdBy,
      ticket.assignment.ownerId
    ]);
    const nameOf = (id: unknown) => (id ? (allNames.get(String(id)) ?? "") : null);

    // Ticket liên quan / ticket gốc (khi đóng "Trùng"): chỉ trả những ticket người xem được phép thấy
    const linkedIds = [...ticket.relatedTicketIds, ticket.duplicateOf].filter(Boolean);
    const linkedDocs = linkedIds.length
      ? ((await TicketModel.find({
          $and: [{ _id: { $in: linkedIds }, isDeleted: false }, visibilityFilter(actor)]
        })
          .select("code title status")
          .lean()) as any[])
      : [];
    const linkedSummary = (linked: any) => ({
      id: String(linked._id),
      code: linked.code,
      title: linked.title,
      status: linked.status
    });

    const sensitiveVisible = canViewSensitiveFiles(ticket, actor);
    const customerRule = customerVisibility(ticket, actor);
    const department = ticket.assignment.departmentId
      ? (await this.deps.directory.getDepartments([ticket.assignment.departmentId]))[0]
      : null;

    return {
      accessLevel: "full" as const,
      ...this.detailFields(ticket, now),
      // Mã khách chỉ trả cho IT / nhóm xử lý / người có quyền xem khách hàng (xem customerVisibility)
      customer: ticket.customer
        ? {
            ...ticket.customer,
            externalId: customerRule.includeExternalId ? ticket.customer.externalId : null
          }
        : null,
      customerAccess: {
        // Khách đã gắn với hồ sơ CRM (chọn từ CRM) hay do người tạo nhập tay — mọi người xem đều biết
        linkedToCrm: Boolean(ticket.customer?.externalId || ticket.customer?.customerId),
        showExternalId: customerRule.showExternalId && Boolean(ticket.customer?.externalId),
        canOpenProfile:
          customerRule.includeExternalId &&
          Boolean(ticket.customer?.externalId) &&
          Boolean(actor.canViewCustomer)
      },
      product: {
        id: ticket.productId,
        name: products.find((item) => item.id === ticket.productId)?.name ?? ""
      },
      category: {
        id: ticket.categoryId,
        name: categories.find((item) => item.id === ticket.categoryId)?.name ?? ""
      },
      template: template ? { id: template.id, name: template.name, fields: template.fields } : null,
      createdBy: { id: ticket.createdBy, name: nameOf(ticket.createdBy) },
      related: linkedDocs
        .filter((linked) => ticket.relatedTicketIds.includes(String(linked._id)))
        .map(linkedSummary),
      duplicateOfTicket:
        linkedDocs
          .filter((linked) => String(linked._id) === ticket.duplicateOf)
          .map(linkedSummary)[0] ?? null,
      assignment: {
        mode: ticket.assignment.mode,
        department: department ? { id: department.id, name: department.name } : null,
        members: ticket.assignment.memberIds.map((id) => ({ id, name: nameOf(id) })),
        owner: ticket.assignment.ownerId
          ? { id: ticket.assignment.ownerId, name: nameOf(ticket.assignment.ownerId) }
          : null,
        collaborators: ticket.assignment.collaboratorIds.map((id) => ({ id, name: nameOf(id) })),
        assignedBy: nameOf(ticket.assignment.assignedBy)
      },
      approval: { ...ticket.approval, verifiedByName: nameOf(ticket.approval.verifiedBy) },
      capabilities: capabilitiesOf(ticket, actor, now),
      messages: messages.map((message: any) => ({
        id: String(message._id),
        author: { id: String(message.author_id), name: nameOf(message.author_id) },
        body: message.body,
        mentions: (message.mention_ids ?? []).map((id: unknown) => ({
          id: String(id),
          name: nameOf(id)
        })),
        createdAt: message.createdAt
      })),
      // File nhạy cảm mà người xem không còn quyền mở: chỉ hiện dòng thông tin (loại giấy tờ, người tải,
      // thời gian), KHÔNG lộ tên file gốc — để biết file vẫn còn, chỉ là không xem được (mục 6.2).
      attachments: attachments.map((file: any) => {
        const canOpen = !file.sensitive || sensitiveVisible;
        return {
          id: String(file._id),
          messageId: file.message_id ? String(file.message_id) : null,
          kind: file.kind,
          sensitive: file.sensitive,
          canOpen,
          name: canOpen ? file.original_name : null,
          mimeType: canOpen ? file.mime_type : null,
          size: canOpen ? file.size : null,
          uploadedBy: nameOf(file.uploaded_by),
          createdAt: file.createdAt
        };
      }),
      activities: activities.map((activity: any) => ({
        id: String(activity._id),
        action: activity.action,
        actor: activity.actor_id
          ? { id: String(activity.actor_id), name: nameOf(activity.actor_id) }
          : null,
        from: activity.from,
        to: activity.to,
        changes: activity.changes ?? [],
        note: activity.note,
        createdAt: activity.createdAt
      }))
    };
  }

  // Tìm file để tải về; kiểm tra quyền (ticket + file nhạy cảm) ở mọi lần tải.
  // eslint-disable-next-line class-methods-use-this
  async getAttachmentFile(actor: TicketActor, ticketId: string, attachmentId: string) {
    const doc = await findTicketDoc(ticketId);
    const ticket = ticketMapper.toDomain(doc).getProps();
    if (accessLevel(ticket, actor) !== "full") throw new TicketNotFoundError();
    if (!mongoose.isValidObjectId(attachmentId)) throw new NotFoundException("File không tồn tại");

    const file = (await TicketAttachmentModel.findOne({
      _id: attachmentId,
      ticket_id: ticket.id,
      isDeleted: false
    }).lean()) as any;
    if (!file) throw new NotFoundException("File không tồn tại");
    if (file.sensitive && !canViewSensitiveFiles(ticket, actor)) {
      throw new NotFoundException("Bạn không còn quyền xem file này");
    }

    // stored_name do server sinh; basename chặn mọi khả năng thoát khỏi thư mục lưu trữ.
    const filePath = path.join(getTicketDir(), path.basename(file.stored_name));
    if (!fs.existsSync(filePath)) throw new NotFoundException("File không còn trên máy chủ");
    return {
      filePath,
      originalName: file.original_name as string,
      mimeType: file.mime_type as string
    };
  }

  // ---- danh mục cho form + nhân sự ----------------------------------------------------------

  async meta(actor: TicketActor) {
    const [products, categories, templates, settings] = await Promise.all([
      this.deps.config.listProducts(true),
      this.deps.config.listCategories(true),
      this.deps.config.listTemplates(true),
      loadTicketSettings()
    ]);
    return {
      products: products.map(({ handlerIds, ...product }) => product),
      categories: categories.map(({ handlerIds, ...category }) => category),
      templates: templates.map(({ handlerIds, ...template }) => template),
      infoRequestCatalog: INFO_REQUEST_CATALOG,
      resolutions: Object.entries(RESOLUTION_LABELS).map(([code, label]) => ({ code, label })),
      policy: {
        autoCloseResolvedDays: settings.policy.autoCloseResolvedDays,
        autoCloseWaitingInfoDays: settings.policy.autoCloseWaitingInfoDays,
        reopenDays: settings.policy.reopenDays
      },
      me: {
        employeeId: actor.employeeId,
        canAssignDepartment: actor.canAssignDepartment,
        canAssignMember: actor.canAssignMember,
        canManage: actor.canManage,
        canViewRestricted: actor.canViewRestricted,
        canViewSensitive: actor.canViewSensitive
      }
    };
  }

  searchEmployees(query: string, limit = 20) {
    return this.deps.directory.searchEmployees(query, Math.min(Math.max(limit, 1), 50));
  }

  listDepartments() {
    return this.deps.directory.listDepartments();
  }

  // Ticket mà người dùng được xem — dùng để chọn ticket "Liên quan"/"Trùng" (chỉ id/mã/tiêu đề).
  async searchTickets(actor: TicketActor, q: string, limit = 10) {
    const keyword = q.trim();
    if (!keyword) return [];
    const filter = buildListFilter({ q: keyword }, actor, this.deps.now());
    const docs = await TicketModel.find(filter)
      .select("code title status customer")
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 20))
      .lean();
    return docs.map((doc: any) => ({
      id: String(doc._id),
      code: doc.code,
      title: doc.title,
      status: doc.status,
      customerPhone: doc.customer?.phone ?? null
    }));
  }

  // ---- nội bộ -------------------------------------------------------------------------------

  private async employeeNames(ids: Array<string | null | undefined | unknown>) {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    const employees = await this.deps.directory.getEmployees(unique);
    return new Map(employees.map((employee) => [employee.id, employee.fullName]));
  }

  // eslint-disable-next-line class-methods-use-this
  private detailFields(ticket: Props, now: Date) {
    return {
      id: ticket.id,
      code: ticket.code,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      urgency: ticket.urgency,
      customFields: ticket.customFields,
      customer: ticket.customer,
      restricted: ticket.visibility === "restricted",
      version: ticket.version,
      resolution: ticket.resolution
        ? { ...ticket.resolution, label: RESOLUTION_LABELS[ticket.resolution.code] }
        : null,
      followUp: ticket.followUp,
      hold: ticket.hold,
      infoRequest: ticket.infoRequest,
      relatedTicketIds: ticket.relatedTicketIds,
      duplicateOf: ticket.duplicateOf,
      dueHintAt: ticket.dueHintAt,
      rescheduleCount: ticket.rescheduleCount,
      yellow: isYellow(ticket as unknown as TicketProps, now)
        ? { reason: ticket.alertReason, since: ticket.alertAt }
        : null,
      autoCloseAt: ticket.autoCloseAt,
      confirmedByRequester: ticket.confirmedByRequester,
      reopenUntil: ticket.reopenUntil,
      reopenCount: ticket.reopenCount,
      closedAt: ticket.closedAt,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      lastActivityAt: ticket.lastActivityAt
    };
  }
}

let defaultService: TicketQueryService | null = null;

export function getTicketQueryService(): TicketQueryService {
  if (!defaultService) defaultService = new TicketQueryService();
  return defaultService;
}

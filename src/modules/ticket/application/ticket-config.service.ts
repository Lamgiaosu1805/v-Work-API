import mongoose, { Model } from "mongoose";
import TicketCategoryModel from "../../../models/TicketCategoryModel";
import TicketProductModel from "../../../models/TicketProductModel";
import TicketSettingModel from "../../../models/TicketSettingModel";
import TicketTemplateModel from "../../../models/TicketTemplateModel";
import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import {
  toCategoryDef,
  toProductDef,
  toTemplateDef
} from "../infrastructure/ticket-config.repository";
import {
  loadTicketSettings,
  settingsFromDoc,
  TICKET_SETTING_KEY
} from "../infrastructure/ticket-settings";
import { TICKET_URGENCIES } from "../domain/types";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { EmployeeSummary, TicketDirectory } from "./ports";

// Quản trị cấu hình ticket (quyền ticket.config): sản phẩm, loại yêu cầu, mẫu yêu cầu, cài đặt chung.
// Toàn bộ là dữ liệu — thêm sản phẩm/mẫu mới không cần sửa code.

export type ConfigKind = "products" | "categories" | "templates";

interface KindDefinition {
  model: Model<any>;
  label: string;
  toDef: (doc: any) => unknown;
  // Chuyển body (camelCase) sang field DB (snake_case); chỉ nhận các field có trong whitelist.
  toDoc: (input: Record<string, any>) => Record<string, unknown>;
  required: string[];
}

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : value);
const objectIds = (values: unknown): unknown[] => {
  const list = Array.isArray(values) ? values : [];
  if (list.some((id) => !mongoose.isValidObjectId(id))) {
    throw new ArgumentInvalidException("Danh sách người phụ trách không hợp lệ");
  }
  return list;
};

function pickDefined(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

const KINDS: Record<ConfigKind, KindDefinition> = {
  products: {
    model: TicketProductModel,
    label: "Sản phẩm",
    toDef: toProductDef,
    required: ["code", "name"],
    toDoc: (input) =>
      pickDefined({
        code: trimmed(input.code),
        name: trimmed(input.name),
        group: input.group,
        app_code: input.appCode,
        description: input.description,
        is_active: input.isActive,
        sort_order: input.sortOrder
      })
  },
  categories: {
    model: TicketCategoryModel,
    label: "Loại yêu cầu",
    toDef: toCategoryDef,
    required: ["code", "name"],
    toDoc: (input) =>
      pickDefined({
        code: trimmed(input.code),
        name: trimmed(input.name),
        description: input.description,
        handler_ids: input.handlerIds === undefined ? undefined : objectIds(input.handlerIds),
        is_active: input.isActive,
        sort_order: input.sortOrder
      })
  },
  templates: {
    model: TicketTemplateModel,
    label: "Mẫu yêu cầu",
    toDef: toTemplateDef,
    required: ["code", "name", "categoryId"],
    toDoc: (input) => {
      if (input.defaultUrgency !== undefined && !TICKET_URGENCIES.includes(input.defaultUrgency)) {
        throw new ArgumentInvalidException("Mức khẩn mặc định không hợp lệ");
      }
      return pickDefined({
        code: trimmed(input.code),
        name: trimmed(input.name),
        category_id: input.categoryId,
        title_pattern: input.titlePattern,
        fields: input.fields,
        required_documents: input.requiredDocuments,
        requires_approval: input.requiresApproval,
        default_urgency: input.defaultUrgency,
        handler_ids: input.handlerIds === undefined ? undefined : objectIds(input.handlerIds),
        guidance: input.guidance,
        is_active: input.isActive,
        sort_order: input.sortOrder
      });
    }
  }
};

function definitionOf(kind: string): KindDefinition {
  const definition = KINDS[kind as ConfigKind];
  if (!definition) throw new NotFoundException("Loại cấu hình không tồn tại");
  return definition;
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

export class TicketConfigService {
  constructor(private readonly directory: TicketDirectory = new MongooseTicketDirectory()) {}

  async list(kind: string) {
    const { model, toDef } = definitionOf(kind);
    const docs = await model.find({ isDeleted: false }).lean();
    const defs = docs.map(toDef) as Array<{ handlerIds?: string[] }>;
    return this.withHandlers(defs);
  }

  // Gắn tên người phụ trách (handlers) bên cạnh handlerIds để màn cấu hình hiển thị được ngay.
  private async withHandlers<T extends { handlerIds?: string[] }>(defs: T[]) {
    const ids = [...new Set(defs.flatMap((def) => def.handlerIds ?? []))];
    if (!ids.length) return defs.map((def) => ({ ...def, handlers: [] as EmployeeSummary[] }));
    const employees = new Map(
      (await this.directory.getEmployees(ids)).map((employee) => [employee.id, employee])
    );
    return defs.map((def) => ({
      ...def,
      handlers: (def.handlerIds ?? [])
        .map((id) => employees.get(id))
        .filter((employee): employee is EmployeeSummary => Boolean(employee))
    }));
  }

  // eslint-disable-next-line class-methods-use-this
  async create(kind: string, input: Record<string, any>) {
    const definition = definitionOf(kind);
    const missing = definition.required.filter((field) => !trimmed(input[field]));
    if (missing.length) {
      throw new ArgumentInvalidException(`${definition.label}: thiếu ${missing.join(", ")}`);
    }
    try {
      const doc = await definition.model.create(definition.toDoc(input));
      return definition.toDef(doc.toObject());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(`${definition.label} với mã "${input.code}" đã tồn tại`);
      }
      throw error;
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async update(kind: string, id: string, input: Record<string, any>) {
    const definition = definitionOf(kind);
    if (!mongoose.isValidObjectId(id))
      throw new NotFoundException(`${definition.label} không tồn tại`);
    try {
      const doc = await definition.model
        .findOneAndUpdate(
          { _id: id, isDeleted: false },
          { $set: definition.toDoc(input) },
          { new: true }
        )
        .lean();
      if (!doc) throw new NotFoundException(`${definition.label} không tồn tại`);
      return definition.toDef(doc);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(`${definition.label} với mã "${input.code}" đã tồn tại`);
      }
      throw error;
    }
  }

  // Xoá mềm; ticket cũ vẫn giữ id và hiển thị tên bình thường.
  // eslint-disable-next-line class-methods-use-this
  async remove(kind: string, id: string) {
    const definition = definitionOf(kind);
    if (!mongoose.isValidObjectId(id))
      throw new NotFoundException(`${definition.label} không tồn tại`);
    const result = await definition.model.updateOne(
      { _id: id, isDeleted: false },
      { $set: { isDeleted: true, is_active: false } }
    );
    if (!result.matchedCount) throw new NotFoundException(`${definition.label} không tồn tại`);
  }

  async getSettings() {
    const settings = await loadTicketSettings();
    const defaultHandlers = await this.directory.getEmployees(settings.defaultHandlerIds);
    return { ...settings, defaultHandlers };
  }

  // eslint-disable-next-line class-methods-use-this
  async updateSettings(input: Record<string, any>) {
    const positive = (value: unknown, name: string) => {
      if (value !== undefined && !(Number(value) > 0)) {
        throw new ArgumentInvalidException(`${name} phải là số dương`);
      }
    };
    positive(input.workdayMinutes, "Số phút của ngày làm việc");
    positive(input.autoCloseResolvedDays, "Số ngày tự đóng ticket đã xử lý");
    positive(input.autoCloseWaitingInfoDays, "Số ngày tự đóng ticket chờ bổ sung");
    positive(input.reopenDays, "Số ngày được mở lại");
    positive(input.holdUnknownDays, "Số ngày cảnh báo tạm hoãn");

    const $set = pickDefined({
      default_handler_ids:
        input.defaultHandlerIds === undefined ? undefined : objectIds(input.defaultHandlerIds),
      workday_minutes: input.workdayMinutes,
      unclaimed_minutes: input.unclaimedMinutes,
      silent_minutes: input.silentMinutes,
      hold_unknown_days: input.holdUnknownDays,
      auto_close_resolved_days: input.autoCloseResolvedDays,
      auto_close_waiting_info_days: input.autoCloseWaitingInfoDays,
      reopen_days: input.reopenDays,
      work_start_minute: input.workStartMinute,
      work_end_minute: input.workEndMinute,
      work_days: input.workDays,
      day_windows: input.dayWindows
    });
    const doc = await TicketSettingModel.findOneAndUpdate(
      { key: TICKET_SETTING_KEY },
      { $set, $setOnInsert: { key: TICKET_SETTING_KEY } },
      { upsert: true, new: true }
    ).lean();
    return settingsFromDoc(doc);
  }
}

let defaultService: TicketConfigService | null = null;

export function getTicketConfigService(): TicketConfigService {
  if (!defaultService) defaultService = new TicketConfigService();
  return defaultService;
}

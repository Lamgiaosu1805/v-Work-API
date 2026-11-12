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
  invalidateTicketConfigCache,
  sortCategories,
  sortProducts,
  sortTemplates,
  toCategoryDef,
  toProductDef,
  toTemplateDef
} from "../infrastructure/ticket-config.repository";
import {
  loadTicketSettings,
  settingsFromDoc,
  TICKET_SETTING_KEY
} from "../infrastructure/ticket-settings";
import { WorkingCalendar } from "../../../shared-kernel/working-calendar";
import { URGENCY_LABELS } from "../domain/ticket-catalog";
import { TICKET_URGENCIES, TicketUrgency } from "../domain/types";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { MongooseSchedulerLoader } from "../infrastructure/ticket-scheduler.loader";
import { logger } from "../../../config/logger";
import { EmployeeSummary, TicketDirectory } from "./ports";
import { refreshActiveTicketSchedules } from "./ticket-schedule-refresh.service";

// Cài đặt làm đổi mốc thời gian của ticket đang mở (người phụ trách mặc định và số ngày mở lại sau khi đóng thì không).
const SCHEDULE_SETTING_KEYS = [
  "workday_minutes",
  "unclaimed_minutes",
  "silent_minutes",
  "hold_unknown_days",
  "auto_close_resolved_days",
  "auto_close_waiting_info_days",
  "work_start_minute",
  "work_end_minute",
  "work_days",
  "day_windows"
];

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
        handler_ids: input.handlerIds === undefined ? undefined : objectIds(input.handlerIds),
        is_active: input.isActive
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
        is_active: input.isActive
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
        fields: Array.isArray(input.fields)
          ? input.fields.map(({ appCodes, ...field }: { appCodes?: unknown[] }) => ({
              ...field,
              app_codes: [
                ...new Set((appCodes ?? []).map((code) => String(code).trim().toLowerCase()))
              ].filter(Boolean)
            }))
          : input.fields,
        required_documents: input.requiredDocuments,
        requires_approval: input.requiresApproval,
        default_urgency: input.defaultUrgency,
        handler_ids: input.handlerIds === undefined ? undefined : objectIds(input.handlerIds),
        guidance: input.guidance,
        is_active: input.isActive
      });
    }
  }
};

function definitionOf(kind: string): KindDefinition {
  const definition = KINDS[kind as ConfigKind];
  if (!definition) throw new NotFoundException("Loại cấu hình không tồn tại");
  return definition;
}

const MINUTES_PER_DAY = 24 * 60;
const isMinuteOfDay = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MINUTES_PER_DAY;

// Ngưỡng cảnh báo theo mức khẩn: phải là số phút dương cho từng mức được gửi lên (0 / rỗng sẽ làm mọi
// ticket bị bôi vàng ngay).
function validateUrgencyMinutes(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object") {
    throw new ArgumentInvalidException(`${label} không hợp lệ`);
  }
  Object.entries(value as Record<string, unknown>).forEach(([urgency, minutes]) => {
    if (!(TICKET_URGENCIES as readonly string[]).includes(urgency)) {
      throw new ArgumentInvalidException(`${label}: mức khẩn "${urgency}" không hợp lệ`);
    }
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
      throw new ArgumentInvalidException(`${label} phải là số phút dương`);
    }
  });
}

// Gộp mức client gửi lên với cài đặt đang lưu (client có thể chỉ gửi một vài mức); không gửi → undefined (không đổi).
function mergeUrgencyMinutes(
  incoming: unknown,
  current: Record<TicketUrgency, number>
): Record<TicketUrgency, number> | undefined {
  if (incoming === undefined) return undefined;
  return { ...current, ...(incoming as Partial<Record<TicketUrgency, number>>) };
}

// Mức càng gấp thì ngưỡng càng ngắn: Khẩn ≤ Cao ≤ Bình thường ≤ Thấp. Kiểm tra trên giá trị đã gộp.
function assertUrgencyOrder(
  merged: Record<TicketUrgency, number> | undefined,
  label: string
): void {
  if (!merged) return;
  for (let i = 1; i < TICKET_URGENCIES.length; i += 1) {
    const more = TICKET_URGENCIES[i - 1];
    const less = TICKET_URGENCIES[i];
    if (merged[more] > merged[less]) {
      throw new ArgumentInvalidException(
        `${label}: mức ${URGENCY_LABELS[more]} không được dài hơn mức ${URGENCY_LABELS[less]}`
      );
    }
  }
}

// Lịch làm việc sau khi gộp với cài đặt hiện tại phải dựng được WorkingCalendar: nếu không, mọi lệnh ghi
// ticket và cron sẽ lỗi 500 cho tới khi sửa lại cài đặt.
async function validateCalendarInput(input: Record<string, any>): Promise<void> {
  const touched = ["workStartMinute", "workEndMinute", "workDays", "dayWindows"].some(
    (key) => input[key] !== undefined
  );
  if (!touched) return;

  ["workStartMinute", "workEndMinute"].forEach((key) => {
    if (input[key] !== undefined && !isMinuteOfDay(input[key])) {
      throw new ArgumentInvalidException("Giờ làm việc không hợp lệ");
    }
  });
  if (input.workDays !== undefined) {
    const days = input.workDays;
    if (
      !Array.isArray(days) ||
      !days.length ||
      days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new ArgumentInvalidException("Phải chọn ít nhất một ngày làm việc hợp lệ");
    }
  }
  if (input.dayWindows !== undefined) {
    const windows = input.dayWindows;
    if (!windows || typeof windows !== "object" || Array.isArray(windows)) {
      throw new ArgumentInvalidException("Khung giờ riêng theo thứ không hợp lệ");
    }
    Object.entries(windows as Record<string, any>).forEach(([day, window]) => {
      if (
        !["0", "1", "2", "3", "4", "5", "6"].includes(day) ||
        !isMinuteOfDay(window?.startMinute) ||
        !isMinuteOfDay(window?.endMinute)
      ) {
        throw new ArgumentInvalidException("Khung giờ riêng theo thứ không hợp lệ");
      }
    });
  }

  const { calendar } = await loadTicketSettings();
  try {
    // eslint-disable-next-line no-new
    new WorkingCalendar({
      workStartMinute: input.workStartMinute ?? calendar.workStartMinute,
      workEndMinute: input.workEndMinute ?? calendar.workEndMinute,
      workDays: input.workDays ?? calendar.workDays,
      dayWindows:
        input.dayWindows === undefined
          ? calendar.dayWindows
          : Object.fromEntries(
              Object.entries(input.dayWindows as Record<string, any>).map(([day, window]) => [
                Number(day),
                window
              ])
            )
    });
  } catch {
    throw new ArgumentInvalidException("Giờ kết thúc phải sau giờ bắt đầu");
  }
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

// Thứ tự cho sản phẩm mới (hoặc vừa đổi nhóm): xuống cuối danh sách. Chưa ai được kéo thả (toàn null) thì để null,
// vì gán số 0 sẽ làm sản phẩm này nhảy lên đầu — sản phẩm cũ vẫn xếp theo ngày tạo như trước.
async function nextProductSortOrder(): Promise<number | null> {
  const top = (await TicketProductModel.findOne({
    isDeleted: false,
    sort_order: { $type: "number" }
  })
    .sort({ sort_order: -1 })
    .select("sort_order")
    .lean()) as { sort_order: number } | null;
  return top ? top.sort_order + 1 : null;
}

export class TicketConfigService {
  constructor(private readonly directory: TicketDirectory = new MongooseTicketDirectory()) {}

  async list(kind: string) {
    const { model, toDef } = definitionOf(kind);
    const docs = await model.find({ isDeleted: false }).lean();
    const defs = docs.map(toDef) as any[];
    // Thứ tự hiển thị: sản phẩm theo nhóm → ngày tạo; loại yêu cầu theo ngày tạo; mẫu theo loại → ngày tạo
    let sorted = defs;
    if (kind === "products") sorted = sortProducts(defs);
    else if (kind === "categories") sorted = sortCategories(defs);
    else if (kind === "templates") {
      const categories = await TicketCategoryModel.find({ isDeleted: false }).lean();
      sorted = sortTemplates(defs, categories.map(toCategoryDef));
    }
    return this.withHandlers(sorted as Array<{ handlerIds?: string[] }>);
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
      const data = definition.toDoc(input);
      if (kind === "products") data.sort_order = await nextProductSortOrder();
      const doc = await definition.model.create(data);
      invalidateTicketConfigCache();
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
      const data = definition.toDoc(input);
      // Đổi nhóm thì sản phẩm sang cuối danh sách (cùng nhóm phải đứng liền nhau)
      if (kind === "products" && "group" in data) {
        const current = await TicketProductModel.findOne({ _id: id, isDeleted: false })
          .select("group")
          .lean();
        if (current && (current.group ?? "") !== (data.group ?? "")) {
          data.sort_order = await nextProductSortOrder();
        }
      }
      const doc = await definition.model
        .findOneAndUpdate({ _id: id, isDeleted: false }, { $set: data }, { new: true })
        .lean();
      if (!doc) throw new NotFoundException(`${definition.label} không tồn tại`);
      invalidateTicketConfigCache();
      return definition.toDef(doc);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(`${definition.label} với mã "${input.code}" đã tồn tại`);
      }
      throw error;
    }
  }

  // Lưu thứ tự hiển thị sản phẩm. `ids` là TOÀN BỘ sản phẩm (kể cả đang tắt) theo thứ tự mới; cùng nhóm phải đứng liền
  // nhau. Gửi cả danh sách (không chỉ "dòng nào chuyển đi đâu") để hai người sửa cùng lúc không làm lệch số.
  // eslint-disable-next-line class-methods-use-this
  async reorderProducts(ids: unknown) {
    if (!Array.isArray(ids) || ids.some((id) => !mongoose.isValidObjectId(id))) {
      throw new ArgumentInvalidException("Danh sách sản phẩm không hợp lệ");
    }
    const wanted = ids.map(String);
    if (new Set(wanted).size !== wanted.length) {
      throw new ArgumentInvalidException("Danh sách sản phẩm bị trùng");
    }

    const docs = await TicketProductModel.find({ isDeleted: false }).select("group").lean();
    const groupOf = new Map(docs.map((doc) => [String(doc._id), doc.group ?? ""]));
    if (groupOf.size !== wanted.length || wanted.some((id) => !groupOf.has(id))) {
      throw new ConflictException(
        "Danh sách sản phẩm đã thay đổi, hãy tải lại trang rồi sắp xếp lại"
      );
    }

    const seen = new Set<string>();
    let previous: string | null = null;
    wanted.forEach((id) => {
      const group = groupOf.get(id) as string;
      if (group !== previous) {
        if (seen.has(group)) {
          throw new ArgumentInvalidException("Các sản phẩm cùng nhóm phải đứng liền nhau");
        }
        seen.add(group);
        previous = group;
      }
    });

    await TicketProductModel.bulkWrite(
      wanted.map((id, index) => ({
        updateOne: {
          filter: { _id: id, isDeleted: false },
          update: { $set: { sort_order: index } }
        }
      }))
    );
    invalidateTicketConfigCache();
    return this.list("products");
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
    invalidateTicketConfigCache();
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
    validateUrgencyMinutes(input.unclaimedMinutes, "Ngưỡng cảnh báo chưa ai nhận");
    validateUrgencyMinutes(input.silentMinutes, "Ngưỡng cảnh báo im lặng");
    // Lưu NGUYÊN object đã gộp (không chỉ phần client gửi): $set cả sub-document sẽ thay hết, các mức không gửi sẽ rơi về mặc định.
    let unclaimedMinutes: Record<TicketUrgency, number> | undefined;
    let silentMinutes: Record<TicketUrgency, number> | undefined;
    if (input.unclaimedMinutes !== undefined || input.silentMinutes !== undefined) {
      const { policy } = await loadTicketSettings();
      unclaimedMinutes = mergeUrgencyMinutes(input.unclaimedMinutes, policy.unclaimedMinutes);
      silentMinutes = mergeUrgencyMinutes(input.silentMinutes, policy.silentMinutes);
      assertUrgencyOrder(unclaimedMinutes, "Ngưỡng chưa ai nhận");
      assertUrgencyOrder(silentMinutes, "Ngưỡng im lặng");
    }
    await validateCalendarInput(input);

    const $set = pickDefined({
      default_handler_ids:
        input.defaultHandlerIds === undefined ? undefined : objectIds(input.defaultHandlerIds),
      workday_minutes: input.workdayMinutes,
      unclaimed_minutes: unclaimedMinutes,
      silent_minutes: silentMinutes,
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

    // Ticket đang mở lưu sẵn mốc vàng / tự đóng / nhắc theo cấu hình cũ: đổi cấu hình thì tính lại ngay. Lỗi ở bước
    // này chỉ log — cài đặt đã lưu xong, mốc của ticket sẽ tự đúng ở thao tác kế tiếp trên ticket đó.
    if (SCHEDULE_SETTING_KEYS.some((key) => key in $set)) {
      try {
        const scheduler = await new MongooseSchedulerLoader().load(new Date());
        await refreshActiveTicketSchedules(scheduler);
      } catch (error) {
        logger.error("Không tính lại mốc ticket sau khi đổi cài đặt chung", { error });
      }
    }
    return settingsFromDoc(doc);
  }
}

let defaultService: TicketConfigService | null = null;

export function getTicketConfigService(): TicketConfigService {
  if (!defaultService) defaultService = new TicketConfigService();
  return defaultService;
}

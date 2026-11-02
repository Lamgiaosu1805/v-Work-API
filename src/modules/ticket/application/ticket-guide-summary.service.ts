import { TICKET_URGENCIES, TicketUrgency } from "../domain/types";
import { URGENCY_LABELS } from "../domain/ticket-catalog";
import { TicketSchedulePolicy, TicketSettings } from "../domain/ticket-schedule";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { loadTicketSettings } from "../infrastructure/ticket-settings";
import { CategoryDef, ProductDef, TemplateDef, TicketConfigReader } from "./ticket-config.types";

// Tóm tắt cấu hình ticket ĐANG ÁP DỤNG (cài đặt chung, sản phẩm, mẫu yêu cầu) thành văn bản cho Trợ lý Nội quy
// trả lời câu hỏi về ticket bằng số liệu thật của môi trường — cấu hình đổi ở màn Cấu hình là câu trả lời đổi
// theo, không phải sửa docs/HUONG-DAN-TICKET.md. Không có tên người phụ trách (không cần cho người hỏi).
//
// Văn bản phải TẤT ĐỊNH (cùng cấu hình → cùng từng byte, không chứa giờ hiện tại): trợ lý đặt nó trong phần
// prompt được cache dùng chung cả công ty, nên chỉ mất cache khi cấu hình thật sự đổi.

const DAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface TicketGuideSummary {
  settings: TicketSettings;
  products: ProductDef[];
  categories: CategoryDef[];
  templates: TemplateDef[];
}

// "30 phút", "4 giờ", "1 ngày 2 giờ" — 1 ngày = workdayMinutes (null = không quy ra ngày).
function formatDuration(minutes: number, workdayMinutes: number | null): string {
  const total = Math.max(0, Math.round(minutes));
  const days = workdayMinutes ? Math.floor(total / workdayMinutes) : 0;
  const rest = total - days * (workdayMinutes ?? 0);
  const parts: string[] = [];
  if (days) parts.push(`${days} ngày`);
  if (Math.floor(rest / 60)) parts.push(`${Math.floor(rest / 60)} giờ`);
  if (rest % 60) parts.push(`${rest % 60} phút`);
  return parts.length ? parts.join(" ") : "0 phút";
}

// "30 phút làm việc", "4 giờ làm việc", "1 ngày làm việc", "1 ngày 2 giờ làm việc".
export function formatWorkingDuration(minutes: number, workdayMinutes: number): string {
  return `${formatDuration(minutes, workdayMinutes)} làm việc`;
}

function formatClock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "Thứ 2, Thứ 3, Thứ 4, Thứ 5, Thứ 6: 08:00–17:00; Thứ 7: 08:00–12:00" (gộp các ngày cùng khung giờ).
function formatWorkWeek(calendar: TicketSettings["calendar"]): string {
  const byWindow = new Map<string, string[]>();
  WEEK_ORDER.filter((day) => calendar.workDays.includes(day)).forEach((day) => {
    const window = calendar.dayWindows?.[day] ?? {
      startMinute: calendar.workStartMinute,
      endMinute: calendar.workEndMinute
    };
    const key = `${formatClock(window.startMinute)}–${formatClock(window.endMinute)}`;
    byWindow.set(key, [...(byWindow.get(key) ?? []), DAY_NAMES[day]]);
  });
  return [...byWindow.entries()]
    .map(([window, days]) => `${days.join(", ")}: ${window}`)
    .join("; ");
}

function urgencyLines(
  label: string,
  values: TicketSchedulePolicy["unclaimedMinutes"],
  workday: number
): string {
  const parts = TICKET_URGENCIES.map(
    (urgency: TicketUrgency) =>
      `${URGENCY_LABELS[urgency]} ${formatWorkingDuration(values[urgency], workday)}`
  );
  return `- ${label}: ${parts.join("; ")}.`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function templateLine(
  template: TemplateDef,
  categoryName: string,
  appNames: Map<string, string>
): string {
  const parts = [`- Mẫu "${template.name}" (loại yêu cầu: ${categoryName})`];
  parts.push(
    `mức khẩn của mẫu: ${URGENCY_LABELS[template.defaultUrgency] ?? template.defaultUrgency}`
  );
  const required = template.fields.filter((field) => field.required).map((field) => field.label);
  if (required.length) parts.push(`thông tin bắt buộc: ${required.join(", ")}`);
  const optional = template.fields
    .filter((field) => !field.required)
    .map((field) => {
      const apps = field.appCodes.map((code) => appNames.get(code) ?? code.toUpperCase());
      return apps.length ? `${field.label} (chỉ với ${apps.join(", ")})` : field.label;
    });
  if (optional.length) parts.push(`thông tin không bắt buộc: ${optional.join(", ")}`);
  const documents = template.requiredDocuments.map((doc) => {
    const flags = [
      doc.required ? "bắt buộc" : "không bắt buộc",
      ...(doc.sensitive ? ["nhạy cảm"] : [])
    ];
    return `${doc.label} (${flags.join(", ")})`;
  });
  if (documents.length) parts.push(`giấy tờ đính kèm: ${documents.join(", ")}`);
  if (template.requiresApproval) parts.push("bắt buộc tờ trình có chữ ký (ticket hạn chế)");
  if (template.guidance.trim()) parts.push(`hướng dẫn của mẫu: ${oneLine(template.guidance)}`);
  return parts.join(" · ");
}

// Hàm thuần: dựng văn bản từ cấu hình đã nạp.
export function formatTicketGuideSummary(summary: TicketGuideSummary): string {
  const { policy, calendar } = summary.settings;
  const workday = policy.workdayMinutes;
  const lines: string[] = [];

  lines.push("Lịch làm việc dùng để tính các mốc của ticket:");
  lines.push(
    `- Giờ làm việc: ${formatWorkWeek(calendar)}. Các ngày khác trong tuần và ngày lễ của công ty không được tính.`
  );
  lines.push(`- "1 ngày làm việc" được tính bằng ${formatDuration(workday, null)} làm việc.`);

  lines.push('Ngưỡng bị đánh dấu "Cần chú ý" (bôi vàng) theo mức khẩn:');
  lines.push(urgencyLines("Chưa ai nhận quá", policy.unclaimedMinutes, workday));
  lines.push(urgencyLines("Đang xử lý mà không có cập nhật quá", policy.silentMinutes, workday));
  lines.push(
    `- Tạm hoãn không có ngày dự kiến tiếp tục và không có cập nhật quá ${formatWorkingDuration(policy.holdUnknownDays * workday, workday)}.`
  );

  lines.push("Tự đóng và mở lại:");
  lines.push(
    `- Ticket "Đã xử lý" mà người tạo không xác nhận: tự đóng với kết quả "Đã giải quyết" sau ${formatWorkingDuration(policy.autoCloseResolvedDays * workday, workday)}.`
  );
  lines.push(
    `- Ticket "Chờ bổ sung" mà người tạo không bổ sung: tự đóng với kết quả "Người tạo không bổ sung" sau ${formatWorkingDuration(policy.autoCloseWaitingInfoDays * workday, workday)}.`
  );
  lines.push(
    `- Mở lại ticket đã đóng (khi người tạo chưa bấm xác nhận): trong ${formatWorkingDuration(policy.reopenDays * workday, workday)} kể từ lúc đóng.`
  );

  lines.push(
    `Sản phẩm đang dùng: ${summary.products.map((p) => (p.group ? `${p.name} (nhóm ${p.group})` : p.name)).join(", ") || "chưa có"}.`
  );
  lines.push(
    `Loại yêu cầu đang dùng: ${summary.categories.map((c) => c.name).join(", ") || "chưa có"}.`
  );

  const categoryNames = new Map(summary.categories.map((category) => [category.id, category.name]));
  const appNames = new Map<string, string>();
  summary.products.forEach((product) => {
    if (product.appCode && !appNames.has(product.appCode)) {
      appNames.set(product.appCode, product.group || product.appCode.toUpperCase());
    }
  });
  const templates = summary.templates.filter((template) => categoryNames.has(template.categoryId));
  lines.push(`Mẫu yêu cầu đang dùng (${templates.length} mẫu):`);
  templates.forEach((template) =>
    lines.push(templateLine(template, categoryNames.get(template.categoryId) as string, appNames))
  );
  return lines.join("\n");
}

export async function loadTicketGuideSummary(
  reader: TicketConfigReader = new MongooseTicketConfigReader()
): Promise<TicketGuideSummary> {
  const [settings, products, categories, templates] = await Promise.all([
    loadTicketSettings(),
    reader.listProducts(true),
    reader.listCategories(true),
    reader.listTemplates(true)
  ]);
  return { settings, products, categories, templates };
}

// Văn bản cấu hình ticket đang áp dụng (đọc DB mỗi lần gọi — nơi gọi tự cache nếu cần).
export async function getTicketGuideText(): Promise<string> {
  return formatTicketGuideSummary(await loadTicketGuideSummary());
}

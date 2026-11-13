import mongoose from "mongoose";
import TicketMessageModel from "../../../models/TicketMessageModel";
import TicketModel from "../../../models/TicketModel";
import { accessLevel } from "../domain/ticket-access";
import { capabilitiesOf, TicketCapabilities } from "../domain/ticket-capabilities";
import {
  ALERT_REASON_LABELS,
  APPROVAL_STATUS_LABELS,
  INFO_REQUEST_CATALOG,
  RESOLUTION_LABELS,
  STATUS_LABELS,
  URGENCY_LABELS
} from "../domain/ticket-catalog";
import { isYellow } from "../domain/ticket-schedule";
import { TicketEntity } from "../domain/ticket.entity";
import { TicketActor, TicketProps } from "../domain/types";
import { ticketMapper } from "../infrastructure/ticket.mapper";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { AbilityLike, buildTicketActorForEmployee } from "./ticket-actor";
import { TicketConfigReader } from "./ticket-config.types";
import { TicketDirectory } from "./ports";
import { maskSecretMarkers } from "./ticket-secrets";

// Tóm tắt MỘT ticket cho Trợ lý Nội quy trả lời "ticket TK-... của tôi đang thế nào". BẢO MẬT:
//  - chỉ ticket do CHÍNH người hỏi tạo (`created_by` = nhân viên đã xác thực). Ticket của người khác, ticket không
//    tồn tại và ticket đã xoá đều trả về y hệt "không tìm thấy" — không cách nào dò xem một mã ticket có tồn tại không;
//  - người tạo thấy đến đâu thì tóm tắt đến đó: dùng đúng `accessLevel` của module (ticket hạn chế đã đóng chỉ còn
//    thông tin chung) và `capabilitiesOf` (nút nào đang có);
//  - KHÔNG đưa mô tả, tên / SĐT khách, nội dung trao đổi, tên file hay tờ trình vào văn bản (chỉ trạng thái và tiến độ).
// Kết quả là các dòng chữ đã dựng sẵn (module trợ lý không biết gì về ticket, chỉ chèn nguyên vào prompt).

export const MAX_ASSISTANT_TICKET_CODES = 3;
const MAX_NOTE_LENGTH = 300;
const CODE_FORMAT = /^TK-\d{4}-\d{4,6}$/;

type Props = ReturnType<TicketEntity["getProps"]>;

export interface OwnTicketBrief {
  code: string;
  lines: string[];
}

export interface OwnTicketsBriefResult {
  briefs: OwnTicketBrief[];
  // Mã đã hỏi nhưng không có trong số ticket do chính người hỏi tạo (không phân biệt sai mã / của người khác).
  notFoundCodes: string[];
}

export interface TicketBriefDeps {
  directory: TicketDirectory;
  config: TicketConfigReader;
  now: () => Date;
}

const defaultDeps = (): TicketBriefDeps => ({
  directory: new MongooseTicketDirectory(),
  config: new MongooseTicketConfigReader(),
  now: () => new Date()
});

// "02/11/2026 15:04" theo giờ VN, không phụ thuộc múi giờ máy chủ.
export function formatVnDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

const clip = (text: string | null | undefined): string => {
  // Văn bản đưa vào prompt gửi Claude: dấu hiệu nội dung ẩn (mật khẩu...) không bao giờ được lọt vào
  const flat = maskSecretMarkers(String(text ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_NOTE_LENGTH ? `${flat.slice(0, MAX_NOTE_LENGTH)}…` : flat;
};

// Mã hợp lệ (TK-YYMM-NNNN), viết hoa, bỏ trùng, tối đa MAX_ASSISTANT_TICKET_CODES.
export function normalizeTicketCodes(codes: string[]): string[] {
  return [...new Set(codes.map((code) => String(code).trim().toUpperCase()))]
    .filter((code) => CODE_FORMAT.test(code))
    .slice(0, MAX_ASSISTANT_TICKET_CODES);
}

// Nút người hỏi ĐANG có trên ticket này: `capabilitiesOf` (theo trạng thái + vai trò trên ticket) lọc thêm bằng quyền thô
// của route — đúng quy tắc web dùng để hiện nút (`availableActionKeys`).
export function availableActions(
  caps: TicketCapabilities,
  can: (action: string) => boolean
): string[] {
  const handle = can("ticket.handle");
  const handleOrManage = handle || can("ticket.manage");
  const create = can("ticket.create");
  const view = can("ticket.view");
  const rules: Array<[boolean, string]> = [
    [caps.submitInfo && create, "Gửi bổ sung"],
    [caps.confirm && create, "Xác nhận đã xong"],
    [caps.reopen && view, "Mở lại"],
    [caps.cancel && create, "Huỷ yêu cầu"],
    [caps.edit && view, "Sửa thông tin"],
    [caps.claim && handle, "Nhận xử lý"],
    [caps.resume && handleOrManage, "Tiếp tục xử lý"],
    [caps.resolve && handleOrManage, "Báo đã xử lý xong"],
    [caps.hold && handleOrManage, "Tạm hoãn"],
    [caps.requestInfo && handleOrManage, "Yêu cầu bổ sung"],
    [caps.verifyApproval && view, "Xác nhận tờ trình"],
    [caps.close && handleOrManage, "Đóng ticket"],
    [caps.release && handle, "Trả lại"],
    [caps.assign && view, "Giao việc"],
    [caps.manageCollaborators && handleOrManage, "Thêm người phối hợp"],
    [caps.setDueHint && handleOrManage, "Đặt ngày dự kiến"],
    [caps.linkRelated && handleOrManage, "Liên kết ticket liên quan"],
    [caps.message && view, "Nhắn trong phần Trao đổi"]
  ];
  return rules.filter(([allowed]) => allowed).map(([, label]) => label);
}

export interface BriefContext {
  now: Date;
  level: "full" | "summary";
  productName: string;
  categoryName: string;
  ownerName: string;
  departmentName: string;
  messageCount: number;
  lastMessage: { authorName: string; at: Date } | null;
  actions: string[];
}

// Hàm thuần: dựng các dòng chữ (một ý một dòng) từ ticket đã nạp + ngữ cảnh tra cứu.
export function buildOwnTicketLines(ticket: Props, context: BriefContext): string[] {
  const { level, actions } = context;
  const restricted = ticket.visibility === "restricted";
  const lines: string[] = [`Tiêu đề: ${ticket.title}`];
  lines.push(`Trạng thái: ${STATUS_LABELS[ticket.status]}${restricted ? " (ticket hạn chế)" : ""}`);

  const actionsLine = actions.length
    ? `Việc bạn làm được ngay trên ticket này: ${actions.join(", ")}`
    : "Việc bạn làm được ngay trên ticket này: không có thao tác nào (ticket đã kết thúc hoặc đang chờ người khác)";

  if (level === "summary") {
    // Ticket hạn chế đã đóng: chỉ còn thông tin chung (docs/TICKET-MODULE-PLAN.md mục 6.1).
    if (ticket.resolution) {
      const note = clip(ticket.resolution.note);
      lines.push(
        `Kết quả: ${RESOLUTION_LABELS[ticket.resolution.code]}${note ? ` — ${note}` : ""}`
      );
    }
    if (ticket.closedAt) lines.push(`Đóng lúc: ${formatVnDateTime(ticket.closedAt)}`);
    if (ticket.reopenUntil) {
      lines.push(`Còn mở lại được đến: ${formatVnDateTime(ticket.reopenUntil)}`);
    }
    lines.push(
      "Đây là ticket hạn chế đã đóng nên chỉ còn xem được thông tin chung; file, tờ trình và trao đổi không còn xem được"
    );
    lines.push(actionsLine);
    return lines;
  }

  lines.push(
    `Mức khẩn: ${URGENCY_LABELS[ticket.urgency]}`,
    `Sản phẩm / loại yêu cầu: ${[context.productName, context.categoryName].filter(Boolean).join(" › ")}`,
    `Tạo lúc: ${formatVnDateTime(ticket.createdAt)}; hoạt động gần nhất: ${formatVnDateTime(ticket.lastActivityAt)}`
  );

  const { assignment } = ticket;
  if (assignment.ownerId) {
    const others = assignment.collaboratorIds.length;
    lines.push(
      `Người xử lý: ${context.ownerName || "(không rõ tên)"} (chủ trì)${others ? ` và ${others} người phối hợp` : ""}`
    );
  } else {
    let target = "";
    if (assignment.mode === "department") {
      target = ` (đã giao cho ${context.departmentName ? `phòng ${context.departmentName}` : "một phòng ban"})`;
    } else if (assignment.mode === "members") {
      target = ` (đã giao cho ${assignment.memberIds.length} người cụ thể)`;
    }
    lines.push(`Chưa có người nhận xử lý${target}`);
  }

  switch (ticket.status) {
    case "waiting_info": {
      const items = (ticket.infoRequest?.items ?? [])
        .filter((item) => !item.fulfilled)
        .map((item) => {
          const label =
            INFO_REQUEST_CATALOG.find((entry) => entry.key === item.key)?.label ?? item.label;
          const note = clip(item.note);
          return note ? `${label} (${note})` : label;
        });
      lines.push(
        `Đang chờ BẠN bổ sung: ${items.join("; ") || "thông tin theo yêu cầu của người xử lý"}`
      );
      if (ticket.infoRequest?.note)
        lines.push(`Ghi chú của người xử lý: ${clip(ticket.infoRequest.note)}`);
      if (ticket.autoCloseAt) {
        lines.push(
          `Không bổ sung thì hệ thống tự đóng lúc: ${formatVnDateTime(ticket.autoCloseAt)}`
        );
      }
      break;
    }
    case "on_hold":
      lines.push(`Tạm hoãn vì: ${clip(ticket.hold?.reason)}`);
      lines.push(
        ticket.hold?.resumeAt
          ? `Dự kiến tiếp tục: ${formatVnDateTime(ticket.hold.resumeAt)}`
          : "Chưa xác định ngày tiếp tục"
      );
      break;
    case "resolved": {
      const note = clip(ticket.resolution?.note);
      const done = clip(ticket.resolution?.actionTaken);
      lines.push(`Nhóm xử lý đã báo xong${note ? `: ${note}` : ""}`);
      if (done) lines.push(`Đã làm: ${done}`);
      if (ticket.followUp?.note) {
        lines.push(
          `Cần theo dõi thêm: ${clip(ticket.followUp.note)}${ticket.followUp.checkAt ? ` (ngày kiểm tra ${formatVnDateTime(ticket.followUp.checkAt)})` : ""}`
        );
      }
      lines.push(
        `Đang chờ BẠN xác nhận${ticket.autoCloseAt ? `; không phản hồi thì tự đóng lúc ${formatVnDateTime(ticket.autoCloseAt)}` : ""}`
      );
      break;
    }
    case "closed": {
      if (ticket.resolution) {
        const note = clip(ticket.resolution.note);
        lines.push(
          `Kết quả: ${RESOLUTION_LABELS[ticket.resolution.code]}${note ? ` — ${note}` : ""}`
        );
        if (ticket.resolution.actionTaken)
          lines.push(`Đã làm: ${clip(ticket.resolution.actionTaken)}`);
      }
      if (ticket.closedAt) lines.push(`Đóng lúc: ${formatVnDateTime(ticket.closedAt)}`);
      if (ticket.confirmedByRequester)
        lines.push("Bạn đã xác nhận đã xong nên không mở lại được nữa");
      else if (ticket.reopenUntil && ticket.reopenUntil.getTime() > context.now.getTime()) {
        lines.push(`Còn mở lại được đến: ${formatVnDateTime(ticket.reopenUntil)}`);
      } else {
        lines.push('Đã quá hạn mở lại; cần dùng "Tạo ticket mới từ ticket này" nếu vấn đề còn');
      }
      break;
    }
    case "cancelled":
      lines.push(`Bạn đã huỷ ticket lúc ${formatVnDateTime(ticket.closedAt)}`);
      break;
    default:
      if (ticket.dueHintAt) {
        lines.push(
          `Ngày dự kiến xong do nhóm xử lý hẹn: ${formatVnDateTime(ticket.dueHintAt)}${ticket.rescheduleCount ? ` (đã dời ${ticket.rescheduleCount} lần)` : ""}`
        );
      }
  }

  if (ticket.approval.required) {
    const note = clip(ticket.approval.note);
    lines.push(
      `Tờ trình: ${APPROVAL_STATUS_LABELS[ticket.approval.status]}${note ? ` — ${note}` : ""}`
    );
  }
  if (isYellow(ticket as unknown as TicketProps, context.now) && ticket.alertReason) {
    lines.push(`Đang bị đánh dấu "Cần chú ý": ${ALERT_REASON_LABELS[ticket.alertReason]}`);
  }
  lines.push(
    context.lastMessage
      ? `Trao đổi: ${context.messageCount} tin nhắn; tin gần nhất của ${context.lastMessage.authorName || "(không rõ tên)"} lúc ${formatVnDateTime(context.lastMessage.at)}`
      : "Trao đổi: chưa có tin nhắn nào"
  );
  lines.push(actionsLine);
  return lines;
}

async function describeOne(
  ticket: Props,
  level: "full" | "summary",
  env: {
    actor: TicketActor;
    can: (action: string) => boolean;
    now: Date;
    deps: TicketBriefDeps;
    products: Array<{ id: string; name: string }>;
    categories: Array<{ id: string; name: string }>;
  }
): Promise<OwnTicketBrief> {
  const { actor, can, now, deps } = env;
  const actions = availableActions(capabilitiesOf(ticket, actor, now), can);
  if (level === "summary") {
    return {
      code: ticket.code,
      lines: buildOwnTicketLines(ticket, {
        now,
        level,
        productName: "",
        categoryName: "",
        ownerName: "",
        departmentName: "",
        messageCount: 0,
        lastMessage: null,
        actions
      })
    };
  }

  const [messageCount, lastMessageDoc, department] = await Promise.all([
    TicketMessageModel.countDocuments({ ticket_id: ticket.id, isDeleted: false }),
    TicketMessageModel.findOne({ ticket_id: ticket.id, isDeleted: false })
      .sort({ createdAt: -1 })
      .select("author_id createdAt")
      .lean() as Promise<any>,
    ticket.assignment.departmentId
      ? deps.directory.getDepartments([ticket.assignment.departmentId])
      : Promise.resolve([])
  ]);
  const people = await deps.directory.getEmployees(
    [ticket.assignment.ownerId, lastMessageDoc ? String(lastMessageDoc.author_id) : null].filter(
      (id): id is string => Boolean(id)
    )
  );
  const nameOf = (id: string | null | undefined) =>
    (id && people.find((person) => person.id === String(id))?.fullName) || "";

  return {
    code: ticket.code,
    lines: buildOwnTicketLines(ticket, {
      now,
      level,
      productName: env.products.find((item) => item.id === ticket.productId)?.name ?? "",
      categoryName: env.categories.find((item) => item.id === ticket.categoryId)?.name ?? "",
      ownerName: nameOf(ticket.assignment.ownerId),
      departmentName: department[0]?.name ?? "",
      messageCount,
      lastMessage: lastMessageDoc
        ? { authorName: nameOf(String(lastMessageDoc.author_id)), at: lastMessageDoc.createdAt }
        : null,
      actions
    })
  };
}

// Tra các mã ticket trong số ticket do CHÍNH `employeeId` tạo. `ability`: bộ quyền của chính họ (để biết nút nào hiện).
export async function describeOwnTickets(
  input: { employeeId: string; ability?: AbilityLike; codes: string[] },
  deps: TicketBriefDeps = defaultDeps()
): Promise<OwnTicketsBriefResult> {
  const codes = normalizeTicketCodes(input.codes);
  if (!codes.length || !mongoose.isValidObjectId(input.employeeId)) {
    return { briefs: [], notFoundCodes: codes };
  }

  // Ranh giới bảo mật: ĐIỀU KIỆN created_by nằm ngay trong câu truy vấn, không lọc sau.
  const docs = (await TicketModel.find({
    code: { $in: codes },
    created_by: input.employeeId,
    isDeleted: false
  }).lean()) as any[];
  if (!docs.length) return { briefs: [], notFoundCodes: codes };

  const now = deps.now();
  const actor: TicketActor = await buildTicketActorForEmployee(
    deps.directory,
    input.employeeId,
    input.ability
  );
  const can = (action: string) => Boolean(input.ability?.can(action, "Ticket"));
  const [products, categories] = await Promise.all([
    deps.config.listProducts(false),
    deps.config.listCategories(false)
  ]);

  const briefs: OwnTicketBrief[] = [];
  for (const doc of docs) {
    const ticket = ticketMapper.toDomain(doc).getProps();
    const level = accessLevel(ticket, actor);
    if (level !== "none") {
      // eslint-disable-next-line no-await-in-loop
      briefs.push(
        await describeOne(ticket, level, { actor, can, now, deps, products, categories })
      );
    }
  }
  const found = new Set(briefs.map((brief) => brief.code));
  return {
    briefs: codes
      .filter((code) => found.has(code))
      .map((code) => briefs.find((b) => b.code === code)!),
    notFoundCodes: codes.filter((code) => !found.has(code))
  };
}

import { TicketActor } from "../domain/types";

// Bộ lọc danh sách ticket (thuần, không đọc DB) — tách riêng để test được. Quy tắc xem (docs mục 6.1):
// ticket thường: người xử lý / quản lý thấy hết, nhân viên thường chỉ thấy ticket của mình và người cùng phòng;
// ticket hạn chế chỉ người liên quan hoặc người có quyền xem ticket hạn chế.

export const TICKET_TABS = [
  "my",
  "needs_reply",
  "unclaimed",
  "department",
  "yellow",
  "all"
] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

// Tab con (chip) của từng tab — chỉ "my" và "department" có. Giá trị lạ → "all".
export const TICKET_SCOPES: Record<string, readonly string[]> = {
  my: ["all", "open", "created", "handling", "assigned"],
  department: ["all", "waiting", "handling", "created"]
};

export interface TicketListQuery {
  tab?: string;
  scope?: string;
  status?: string[];
  productId?: string;
  categoryId?: string;
  templateId?: string;
  urgency?: string;
  ownerId?: string;
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

// Dữ liệu tổ chức mà một số tab cần (đã tra sẵn ở service để bộ lọc này thuần, không đọc DB).
export interface TicketFilterContext {
  // Mọi nhân viên thuộc phòng của người xem, kể cả phòng con (tab "department")
  departmentEmployeeIds?: string[];
}

type Filter = Record<string, unknown>;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Đang còn xử lý dở (chưa đóng/huỷ)
const ACTIVE_STATUSES = ["open", "in_progress", "waiting_info", "on_hold", "resolved"];
const OPEN_STATUSES = ["open", "in_progress", "on_hold"];
const WORKING_STATUSES = ["in_progress", "waiting_info", "on_hold", "resolved"];

export function visibilityFilter(actor: TicketActor): Filter {
  if (actor.canViewRestricted) return {};
  return {
    $or: [
      // Ticket thường: người xử lý / quản lý xem hết; nhân viên thường chỉ ticket người cùng phòng tạo (ticket của
      // chính mình, được giao, phối hợp đã có ở các nhánh dưới) — khớp isCreatedByColleague ở domain
      actor.canViewAll
        ? { visibility: "normal" }
        : { visibility: "normal", created_by: { $in: actor.colleagueIds } },
      { created_by: actor.employeeId },
      { "assignment.owner_id": actor.employeeId },
      { "assignment.collaborator_ids": actor.employeeId },
      // Người được giao đích danh khi chưa có chủ trì (khớp isInvolved ở domain)
      { "assignment.owner_id": null, "assignment.member_ids": actor.employeeId },
      // Thành viên phòng được giao, ticket còn chờ nhận (khớp isDepartmentCandidate ở domain)
      {
        "assignment.mode": "department",
        "assignment.owner_id": null,
        "assignment.department_id": { $in: actor.departmentIds }
      }
    ]
  };
}

export const normalizeScope = (tab: string | undefined, scope: string | undefined): string =>
  tab && scope && TICKET_SCOPES[tab]?.includes(scope) ? scope : "all";

// Tab "Ticket của tôi": tôi tạo, tôi xử lý (chủ trì/phối hợp), hoặc giao đích danh cho tôi (chờ nhận).
function myFilter(scope: string, actor: TicketActor): Filter {
  const me = actor.employeeId;
  const assignedWaiting: Filter = {
    status: "open",
    "assignment.owner_id": null,
    "assignment.member_ids": me
  };
  // Giao riêng cho tôi, chưa có chủ trì: vẫn thuộc "của tôi" khi đang chờ bổ sung / tạm hoãn (chip "Giao cho tôi" chỉ
  // lấy ticket đang chờ nhận).
  const assignedPending: Filter = {
    status: { $nin: ["closed", "cancelled"] },
    "assignment.owner_id": null,
    "assignment.member_ids": me
  };
  const handling: Filter = {
    $or: [{ "assignment.owner_id": me }, { "assignment.collaborator_ids": me }]
  };
  const everything: Filter = { $or: [{ created_by: me }, handling, assignedPending] };

  switch (scope) {
    case "open":
      return { $and: [everything, { status: { $in: ACTIVE_STATUSES } }] };
    case "created":
      return { created_by: me };
    case "handling":
      return { $and: [handling, { status: { $in: WORKING_STATUSES } }] };
    case "assigned":
      return assignedWaiting;
    default:
      return everything;
  }
}

// Tab "Ticket phòng ban": giao cho phòng tôi (gồm phòng cha của tôi) + việc của người trong phòng tôi.
function departmentFilter(scope: string, actor: TicketActor, employeeIds: string[]): Filter {
  const assignedToDept: Filter = {
    "assignment.mode": "department",
    "assignment.department_id": { $in: actor.departmentIds }
  };
  const handledByDept: Filter = {
    $or: [
      { "assignment.owner_id": { $in: employeeIds } },
      { "assignment.collaborator_ids": { $in: employeeIds } }
    ]
  };
  const createdByDept: Filter = { created_by: { $in: employeeIds } };

  switch (scope) {
    case "waiting":
      return { status: "open", "assignment.owner_id": null, ...assignedToDept };
    case "handling":
      return { $and: [handledByDept, { status: { $in: WORKING_STATUSES } }] };
    case "created":
      return createdByDept;
    default:
      return { $or: [assignedToDept, handledByDept, createdByDept] };
  }
}

export function tabFilter(
  query: Pick<TicketListQuery, "tab" | "scope">,
  actor: TicketActor,
  now: Date,
  context: TicketFilterContext = {}
): Filter {
  const scope = normalizeScope(query.tab, query.scope);
  switch (query.tab as TicketTab) {
    case "my":
      return myFilter(scope, actor);
    case "needs_reply":
      // Ticket tôi tạo đang chờ tôi: cần bổ sung thông tin hoặc cần xác nhận đã xong
      return { created_by: actor.employeeId, status: { $in: ["waiting_info", "resolved"] } };
    case "unclaimed":
      // Chưa giao cho ai: cả công ty nhận được. Ticket giao riêng / giao phòng nằm ở tab của người đó.
      return { status: "open", "assignment.owner_id": null, "assignment.mode": "none" };
    case "department":
      return departmentFilter(scope, actor, context.departmentEmployeeIds ?? []);
    case "yellow":
      return { status: { $in: OPEN_STATUSES }, alert_at: { $lte: now } };
    default:
      return {};
  }
}

// Gộp nhiều điều kiện bằng $and để các $or của từng phần không đè lên nhau.
export function buildListFilter(
  query: TicketListQuery,
  actor: TicketActor,
  now: Date,
  context: TicketFilterContext = {}
): Filter {
  const parts: Filter[] = [
    { isDeleted: false },
    visibilityFilter(actor),
    tabFilter(query, actor, now, context)
  ];

  const direct: Filter = {};
  if (query.status?.length) direct.status = { $in: query.status };
  if (query.productId) direct.product_id = query.productId;
  if (query.categoryId) direct.category_id = query.categoryId;
  if (query.templateId) direct.template_id = query.templateId;
  if (query.urgency) direct.urgency = query.urgency;
  if (query.ownerId) direct["assignment.owner_id"] = query.ownerId;
  if (query.from || query.to) {
    direct.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {})
    };
  }
  parts.push(direct);

  const keyword = query.q?.trim();
  if (keyword) {
    // Escape trước khi đưa vào $regex để từ khoá không thành biểu thức (ReDoS / NoSQL injection)
    const pattern = new RegExp(escapeRegex(keyword), "i");
    // Ticket hạn chế đã kết thúc chỉ còn thông tin chung với người liên quan (không thấy khách) nên không cho tìm
    // theo SĐT / tên khách — nếu không có thể dò SĐT của khách qua kết quả khớp.
    const customerMatch: Filter = {
      $or: [{ "customer.phone": pattern }, { "customer.name": pattern }]
    };
    const summaryOnly: Filter = {
      visibility: "restricted",
      status: { $in: ["closed", "cancelled"] }
    };
    parts.push({
      $or: [
        { code: pattern },
        { title: pattern },
        actor.canViewRestricted ? customerMatch : { $and: [customerMatch, { $nor: [summaryOnly] }] }
      ]
    });
  }

  const meaningful = parts.filter((part) => Object.keys(part).length > 0);
  return meaningful.length === 1 ? meaningful[0] : { $and: meaningful };
}

export function listSort(tab: string | undefined): Record<string, 1 | -1> {
  return tab === "yellow" ? { alert_at: 1 } : { createdAt: -1 };
}

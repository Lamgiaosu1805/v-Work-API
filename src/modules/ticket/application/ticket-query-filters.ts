import { TicketActor } from "../domain/types";

// Bộ lọc danh sách ticket (thuần, không đọc DB) — tách riêng để test được. Quy tắc xem (docs mục 6.1):
// ticket thường ai cũng thấy; ticket hạn chế chỉ người liên quan hoặc người có quyền xem ticket hạn chế.

export const TICKET_TABS = [
  "unclaimed",
  "mine",
  "created",
  "assigned_to_me",
  "my_department",
  "yellow",
  "closed",
  "all"
] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

export interface TicketListQuery {
  tab?: string;
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

type Filter = Record<string, unknown>;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPEN_STATUSES = ["open", "in_progress", "on_hold"];
const WORKING_STATUSES = ["in_progress", "waiting_info", "on_hold", "resolved"];

export function visibilityFilter(actor: TicketActor): Filter {
  if (actor.canViewRestricted) return {};
  return {
    $or: [
      { visibility: "normal" },
      { created_by: actor.employeeId },
      { "assignment.owner_id": actor.employeeId },
      { "assignment.collaborator_ids": actor.employeeId },
      { "assignment.member_ids": actor.employeeId }
    ]
  };
}

export function tabFilter(tab: string | undefined, actor: TicketActor, now: Date): Filter {
  switch (tab as TicketTab) {
    case "unclaimed":
      // Ticket đang chờ người nhận mà tôi nhận được (không giao, giao tôi, hoặc giao phòng của tôi)
      return {
        status: "open",
        "assignment.owner_id": null,
        $or: [
          { "assignment.mode": "none" },
          { "assignment.member_ids": actor.employeeId },
          { "assignment.department_id": { $in: actor.departmentIds } }
        ]
      };
    case "mine":
      return {
        status: { $in: WORKING_STATUSES },
        $or: [
          { "assignment.owner_id": actor.employeeId },
          { "assignment.collaborator_ids": actor.employeeId }
        ]
      };
    case "created":
      return { created_by: actor.employeeId };
    case "assigned_to_me":
      return {
        status: "open",
        "assignment.owner_id": null,
        "assignment.member_ids": actor.employeeId
      };
    case "my_department":
      return {
        status: "open",
        "assignment.owner_id": null,
        "assignment.mode": "department",
        "assignment.department_id": { $in: actor.departmentIds }
      };
    case "yellow":
      return { status: { $in: OPEN_STATUSES }, alert_at: { $lte: now } };
    case "closed":
      return { status: { $in: ["closed", "cancelled"] } };
    default:
      return {};
  }
}

// Gộp nhiều điều kiện bằng $and để các $or của từng phần không đè lên nhau.
export function buildListFilter(query: TicketListQuery, actor: TicketActor, now: Date): Filter {
  const parts: Filter[] = [
    { isDeleted: false },
    visibilityFilter(actor),
    tabFilter(query.tab, actor, now)
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
    parts.push({
      $or: [
        { code: pattern },
        { title: pattern },
        { "customer.phone": pattern },
        { "customer.name": pattern }
      ]
    });
  }

  const meaningful = parts.filter((part) => Object.keys(part).length > 0);
  return meaningful.length === 1 ? meaningful[0] : { $and: meaningful };
}

export function listSort(tab: string | undefined): Record<string, 1 | -1> {
  return tab === "yellow" ? { alert_at: 1 } : { createdAt: -1 };
}

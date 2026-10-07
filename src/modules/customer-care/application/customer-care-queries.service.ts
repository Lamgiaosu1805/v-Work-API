// Use-case ĐỌC (CQRS-lite): query thẳng Mongoose, không dựng Entity.
import mongoose from "mongoose";
import { Ability, toMongoQuery, canOnSubject } from "../../permission";
import CustomerAssignmentModel from "../../../models/CustomerAssignmentModel";
import CustomerCareStateModel from "../../../models/CustomerCareStateModel";
import CustomerModel from "../../../models/CustomerModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { ForbiddenException } from "../../../core/exceptions/exceptions";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";
import { REVOKE_REASONS } from "../domain/customer-assignment.entity";
import { startOfVnDay } from "../domain/working-calendar";
import { resolveAppId } from "../infrastructure/care-context";

const CUSTOMER_FIELDS =
  "phone_number identity.full_name status external_id source_type registeredAt";
const SALE_FIELDS = "full_name ma_nv";

/**
 * Phạm vi dữ liệu: dùng lại data scope của entity Customer (CUSTOMER_ALL_COMPANY / OWN_DEPARTMENT /
 * SELF_ASSIGNED — điều kiện trên `referred_by` = Sale phụ trách) và quy đổi sang field Sale của lượt giao.
 */
function renameField(condition: unknown, from: string, to: string): unknown {
  if (Array.isArray(condition)) return condition.map((c) => renameField(c, from, to));
  if (!condition || typeof condition !== "object" || condition instanceof mongoose.Types.ObjectId) {
    return condition;
  }
  return Object.fromEntries(
    Object.entries(condition as Record<string, unknown>).map(([key, value]) => [
      key === from ? to : key,
      key.startsWith("$") ? renameField(value, from, to) : value
    ])
  );
}

function saleScopeFilter(ability: Ability, action: string, field: string): Record<string, unknown> {
  const query = castObjectIdFields(toMongoQuery(ability, action, "Customer"), ["referred_by"]);
  return renameField(query, "referred_by", field) as Record<string, unknown>;
}

export function isCompanyWideScope(ability: Ability, action: string): boolean {
  return canOnSubject(ability, action, "Customer", {
    referred_by: new mongoose.Types.ObjectId()
  });
}

async function appFilter(appCode?: string): Promise<Record<string, unknown>> {
  if (!appCode) return {};
  const appId = await resolveAppId(appCode);
  return { app_id: appId ? new mongoose.Types.ObjectId(appId) : null };
}

// ─── Hàng đợi của Sale ──────────────────────────────────────────────────────────────────

export type SlaState = "waiting_first_contact" | "warning" | "overdue" | "in_care" | "inactive_due";

export function computeSlaState(row: any, now: Date): SlaState {
  const t = now.getTime();
  if (!row.first_contact_at) {
    if (t >= new Date(row.first_contact_due_at).getTime()) return "overdue";
    return "waiting_first_contact";
  }
  if (t >= new Date(row.inactivity_due_at).getTime()) return "inactive_due";
  if (row.warned_at && !row.last_valid_activity_at) return "warning";
  return "in_care";
}

export async function listMyCareQueue(saleId: string, now: Date) {
  const rows = await CustomerAssignmentModel.find({
    sale_id: saleId,
    status: "active",
    isDeleted: false
  })
    .populate("customer_id", CUSTOMER_FIELDS)
    .sort({ first_contact_at: 1, first_contact_due_at: 1 })
    .lean();

  const data = rows.map((row: any) => ({
    ...row,
    sla_state: computeSlaState(row, now)
  }));
  const summary = {
    total: data.length,
    not_contacted: data.filter((r) => !r.first_contact_at).length,
    overdue: data.filter((r) => r.sla_state === "overdue").length,
    appointments_today: data.filter(
      (r) =>
        r.appointment_at &&
        startOfVnDay(new Date(r.appointment_at)).getTime() === startOfVnDay(now).getTime()
    ).length
  };
  return { data, summary, server_time: now };
}

// ─── Danh sách lượt giao (quản lý) ─────────────────────────────────────────────────────

export interface ListAssignmentsFilters extends PaginationQuery {
  appCode?: string;
  saleId?: string;
  status?: "active" | "ended";
  endedReason?: string;
  breachedOnly?: boolean;
  from?: Date;
  to?: Date;
}

export async function listAssignments(ability: Ability, filters: ListAssignmentsFilters) {
  const { page, limit, skip } = parsePagination(filters);
  const and: Record<string, unknown>[] = [
    saleScopeFilter(ability, "customer_care.manage", "sale_id"),
    { isDeleted: false },
    await appFilter(filters.appCode)
  ];
  if (filters.saleId) and.push({ sale_id: new mongoose.Types.ObjectId(filters.saleId) });
  if (filters.status) and.push({ status: filters.status });
  if (filters.endedReason === "revoked") and.push({ ended_reason: { $in: REVOKE_REASONS } });
  else if (filters.endedReason) and.push({ ended_reason: filters.endedReason });
  if (filters.breachedOnly) {
    and.push({
      $or: [
        { first_contact_breached: true },
        { first_contact_at: null, first_contact_due_at: { $lt: new Date() }, status: "active" }
      ]
    });
  }
  if (filters.from || filters.to) {
    and.push({
      assigned_at: {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {})
      }
    });
  }
  const match = { $and: and };
  const [data, total] = await Promise.all([
    CustomerAssignmentModel.find(match)
      .populate("customer_id", CUSTOMER_FIELDS)
      .populate("sale_id", SALE_FIELDS)
      .sort({ assigned_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CustomerAssignmentModel.countDocuments(match)
  ]);
  return { data, total, page, limit };
}

/** Lịch sử giao / thu hồi của 1 khách. */
export async function listCustomerAssignmentHistory(customerId: string) {
  const [state, history] = await Promise.all([
    CustomerCareStateModel.findOne({ customer_id: customerId, isDeleted: false })
      .populate("current_sale_id", SALE_FIELDS)
      .lean(),
    CustomerAssignmentModel.find({ customer_id: customerId, isDeleted: false })
      .populate("sale_id", SALE_FIELDS)
      .sort({ assigned_at: -1 })
      .lean()
  ]);
  return { state, history };
}

// ─── Pool + hàng đợi CSKH ──────────────────────────────────────────────────────────────

export interface ListPoolFilters extends PaginationQuery {
  appCode?: string;
  poolStatus?: "in_pool" | "nurturing" | "excluded";
  priorityClass?: "A" | "B" | "C";
}

export async function listPool(ability: Ability, filters: ListPoolFilters) {
  if (!isCompanyWideScope(ability, "customer_care.manage")) {
    throw new ForbiddenException("Chỉ quản lý phạm vi toàn công ty mới xem được kho khách chung");
  }
  const { page, limit, skip } = parsePagination(filters);
  const match: Record<string, unknown> = {
    isDeleted: false,
    pool_status: filters.poolStatus ?? "in_pool",
    ...(await appFilter(filters.appCode))
  };
  if (filters.priorityClass) match.priority_class = filters.priorityClass;
  const [data, total] = await Promise.all([
    CustomerCareStateModel.find(match)
      .populate("customer_id", CUSTOMER_FIELDS)
      .sort({ low_priority: 1, priority_class: 1, entered_pool_at: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CustomerCareStateModel.countDocuments(match)
  ]);
  return { data, total, page, limit };
}

// ─── Dashboard vận hành (Điều 9 — bản cho khách đã đăng ký) ────────────────────────────

export async function getCareDashboard(
  ability: Ability,
  input: { appCode?: string; from: Date; to: Date; now: Date }
) {
  const scope = saleScopeFilter(ability, "customer_care.manage", "sale_id");
  const app = await appFilter(input.appCode);
  const base = { ...app, isDeleted: false };
  const companyWide = isCompanyWideScope(ability, "customer_care.manage");

  const [poolByClass, activeRows, periodRows, saleRows] = await Promise.all([
    companyWide
      ? CustomerCareStateModel.aggregate([
          { $match: { ...base, pool_status: { $in: ["in_pool", "nurturing"] } } },
          {
            $group: {
              _id: { status: "$pool_status", cls: "$priority_class" },
              count: { $sum: 1 }
            }
          }
        ])
      : Promise.resolve([]),
    CustomerAssignmentModel.aggregate([
      { $match: { $and: [scope, base, { status: "active" }] } },
      {
        $group: {
          _id: null,
          active: { $sum: 1 },
          not_contacted: { $sum: { $cond: [{ $eq: ["$first_contact_at", null] }, 1, 0] } },
          overdue_first_contact: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$first_contact_at", null] },
                    { $lt: ["$first_contact_due_at", input.now] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]),
    CustomerAssignmentModel.aggregate([
      { $match: { $and: [scope, base, { assigned_at: { $gte: input.from, $lte: input.to } }] } },
      {
        $group: {
          _id: null,
          assigned: { $sum: 1 },
          contacted: { $sum: { $cond: [{ $ne: ["$first_contact_at", null] }, 1, 0] } },
          contacted_on_time: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$first_contact_at", null] },
                    { $eq: ["$first_contact_breached", false] }
                  ]
                },
                1,
                0
              ]
            }
          },
          revoked: { $sum: { $cond: [{ $in: ["$ended_reason", REVOKE_REASONS] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ["$ended_reason", "converted"] }, 1, 0] } }
        }
      }
    ]),
    CustomerAssignmentModel.aggregate([
      {
        $match: {
          $and: [
            scope,
            base,
            {
              $or: [{ status: "active" }, { assigned_at: { $gte: input.from, $lte: input.to } }]
            }
          ]
        }
      },
      {
        $group: {
          _id: "$sale_id",
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          assigned_in_period: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$assigned_at", input.from] },
                    { $lte: ["$assigned_at", input.to] }
                  ]
                },
                1,
                0
              ]
            }
          },
          assigned_today: {
            $sum: { $cond: [{ $gte: ["$assigned_at", startOfVnDay(input.now)] }, 1, 0] }
          },
          contacted_on_time: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$first_contact_at", null] },
                    { $eq: ["$first_contact_breached", false] },
                    { $gte: ["$assigned_at", input.from] }
                  ]
                },
                1,
                0
              ]
            }
          },
          overdue_now: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "active"] },
                    { $eq: ["$first_contact_at", null] },
                    { $lt: ["$first_contact_due_at", input.now] }
                  ]
                },
                1,
                0
              ]
            }
          },
          revoked: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ["$ended_reason", REVOKE_REASONS] },
                    { $gte: ["$assigned_at", input.from] }
                  ]
                },
                1,
                0
              ]
            }
          },
          converted: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$ended_reason", "converted"] },
                    { $gte: ["$assigned_at", input.from] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ])
  ]);

  const sales = await UserInfoModel.find({ _id: { $in: saleRows.map((r: any) => r._id) } })
    .select(SALE_FIELDS)
    .lean();
  const saleById = new Map(sales.map((s: any) => [String(s._id), s]));
  const period = periodRows[0] ?? {
    assigned: 0,
    contacted: 0,
    contacted_on_time: 0,
    revoked: 0,
    converted: 0
  };
  const pool = { in_pool: { A: 0, B: 0 }, nurturing: 0 } as {
    in_pool: Record<string, number>;
    nurturing: number;
  };
  poolByClass.forEach((row: any) => {
    if (row._id.status === "nurturing") pool.nurturing += row.count;
    else pool.in_pool[row._id.cls] = (pool.in_pool[row._id.cls] ?? 0) + row.count;
  });

  return {
    pool: companyWide ? pool : null,
    current: activeRows[0] ?? { active: 0, not_contacted: 0, overdue_first_contact: 0 },
    period: {
      ...period,
      on_time_rate: period.assigned ? period.contacted_on_time / period.assigned : null,
      conversion_rate: period.assigned ? period.converted / period.assigned : null
    },
    by_sale: saleRows
      .map((row: any) => ({
        sale_id: row._id,
        sale: saleById.get(String(row._id)) ?? null,
        active: row.active,
        assigned_today: row.assigned_today,
        assigned_in_period: row.assigned_in_period,
        overdue_now: row.overdue_now,
        revoked: row.revoked,
        converted: row.converted,
        on_time_rate: row.assigned_in_period ? row.contacted_on_time / row.assigned_in_period : null
      }))
      .sort((a: any, b: any) => b.active - a.active)
  };
}

/** Khách có thuộc phạm vi chăm sóc (đã có trạng thái) không — dùng để quyết định form báo cáo bắt buộc. */
export async function getActiveAssignmentForCustomer(customerId: string) {
  return CustomerAssignmentModel.findOne({
    customer_id: customerId,
    status: "active",
    isDeleted: false
  }).lean();
}

export async function getCustomerBasics(customerId: string) {
  return CustomerModel.findOne({ _id: customerId, isDeleted: false })
    .select("app_id referred_by status identity.verified_at phone_number identity.full_name")
    .lean();
}

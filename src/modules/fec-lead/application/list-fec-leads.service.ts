import mongoose from "mongoose";
import AppModel from "../../../models/AppModel";
import CustomerModel from "../../../models/CustomerModel";
import FecLeadModel, { FecLeadStage } from "../../../models/FecLeadModel";
import UserInfoModel from "../../../models/UserInfoModel";
import {
  ArgumentInvalidException,
  ForbiddenException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";
import {
  adviceFor,
  currentStepLabel,
  FEC_STAGE_LABELS,
  stepLabel
} from "../domain/fec-lead-presentation";

// Đọc bypass domain (CQRS-lite): chỉ truy vấn, không dựng entity.

const STAGES: FecLeadStage[] = [
  "FOLLOW_UP",
  "IN_PROGRESS",
  "COMPLETED",
  "STOPPED",
  "REJECTED_AT_START"
];

export type FecLeadStageCounts = Record<FecLeadStage, number>;

export interface ListFecLeadsInput extends PaginationQuery {
  appCode: string;
  /**
   * Bộ lọc Mongo trên Customer (phạm vi dữ liệu của người xem, do workflow dựng từ quyền customer.view).
   * `{}` = không giới hạn. Module không tự biết quyền, chỉ áp bộ lọc này.
   */
  customerScope: Record<string, unknown>;
  bucket?: string;
  q?: string;
}

export interface FecLeadListItem {
  lead_gen_id: string;
  bucket: FecLeadStage;
  last_step: string | null;
  stop_reason: string | null;
  /** Nhãn bước hiện tại và gợi ý cho Sale — dựng ở server để màn hình và Excel dùng chung */
  step_label: string;
  advice: string;
  dropped_off: boolean;
  lead_status: string;
  created_at: Date;
  last_event_at: Date;
  callback_count: number;
  offer_amt: number | null;
  cash_amt: number | null;
  customer: {
    _id: string;
    external_id: string | null;
    full_name: string | null;
    phone_number: string | null;
  } | null;
  sale: { full_name: string; ma_nv: string } | null;
}

export interface ListFecLeadsResult {
  data: FecLeadListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  counts: FecLeadStageCounts;
}

export interface FecLeadHistoryEntry {
  status: string;
  status_label: string;
  remark: string | null;
  request_time: string | null;
  received_at: Date;
  offer_amt: number | null;
  cash_amt: number | null;
  insurance_amt: number | null;
  topup_amt: number | null;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isEmptyFilter = (filter: Record<string, unknown>) => Object.keys(filter).length === 0;

const toStage = (value: unknown): FecLeadStage | null =>
  typeof value === "string" && (STAGES as string[]).includes(value)
    ? (value as FecLeadStage)
    : null;

async function toListItems(leads: any[]): Promise<FecLeadListItem[]> {
  const customerIds = [...new Set(leads.map((lead) => String(lead.customer_id)))];
  const customers = await CustomerModel.find({ _id: { $in: customerIds } })
    .select("external_id phone_number identity.full_name referred_by")
    .lean();
  const customerById = new Map<string, any>(customers.map((c: any) => [String(c._id), c]));

  const saleIds = [
    ...new Set(
      customers
        .map((c: any) => c.referred_by)
        .filter(Boolean)
        .map((id: any) => String(id))
    )
  ];
  const sales = saleIds.length
    ? await UserInfoModel.find({ _id: { $in: saleIds }, isDeleted: false })
        .select("full_name ma_nv")
        .lean()
    : [];
  const saleById = new Map<string, any>(sales.map((s: any) => [String(s._id), s]));

  return leads.map((lead) => {
    const customer = customerById.get(String(lead.customer_id));
    const sale = customer?.referred_by ? saleById.get(String(customer.referred_by)) : null;
    return {
      lead_gen_id: lead.lead_gen_id,
      bucket: lead.stage,
      last_step: lead.last_step ?? null,
      stop_reason: lead.stop_reason ?? null,
      step_label: currentStepLabel({
        stage: lead.stage,
        last_step: lead.last_step,
        stop_reason: lead.stop_reason
      }),
      advice: adviceFor({
        stage: lead.stage,
        last_step: lead.last_step,
        stop_reason: lead.stop_reason
      }),
      dropped_off: Boolean(lead.dropped_off),
      lead_status: lead.lead_status,
      created_at: lead.lead_created_at,
      last_event_at: lead.last_event_at,
      // version = số callback đã nhận (VNFITE gửi kèm trong snapshot)
      callback_count: lead.version ?? 0,
      offer_amt: lead.offer_amt ?? null,
      cash_amt: lead.cash_amt ?? null,
      customer: customer
        ? {
            _id: String(customer._id),
            external_id: customer.external_id ?? null,
            full_name: customer.identity?.full_name ?? null,
            phone_number: customer.phone_number ?? null
          }
        : null,
      sale: sale ? { full_name: sale.full_name, ma_nv: sale.ma_nv } : null
    };
  });
}

// Dựng bộ lọc lead trong phạm vi người xem (+ từ khoá). Dùng chung cho danh sách và xuất Excel.
async function buildLeadBaseFilter(input: ListFecLeadsInput): Promise<Record<string, unknown>> {
  const app = await AppModel.findOne({ code: input.appCode, is_active: true }).select("_id").lean();
  if (!app) throw new NotFoundException("Không tìm thấy app");

  // Khách trong phạm vi người xem (find tự cast id nên không cần cast tay như aggregate)
  const customerFilter = { $and: [{ app_id: app._id, isDeleted: false }, input.customerScope] };

  const base: Record<string, unknown> = { isDeleted: false, app_code: input.appCode };
  if (!isEmptyFilter(input.customerScope)) {
    const scoped = await CustomerModel.find(customerFilter).select("_id").lean();
    base.customer_id = { $in: scoped.map((c: any) => c._id) };
  }

  const keyword = (input.q ?? "").trim().slice(0, 100);
  if (keyword) {
    const pattern = new RegExp(escapeRegex(keyword), "i");
    const matched = await CustomerModel.find({
      $and: [
        customerFilter,
        {
          $or: [
            { phone_number: pattern },
            { "identity.full_name": pattern },
            { external_id: pattern }
          ]
        }
      ]
    })
      .select("_id")
      .lean();
    base.$and = [
      { $or: [{ lead_gen_id: pattern }, { customer_id: { $in: matched.map((c: any) => c._id) } }] }
    ];
  }

  return base;
}

export async function listFecLeads(input: ListFecLeadsInput): Promise<ListFecLeadsResult> {
  const { page, limit, skip } = parsePagination(input);
  const base = await buildLeadBaseFilter(input);

  // aggregate không tự cast; mọi id trong `base` đã là ObjectId (lấy từ find().lean())
  const grouped = await FecLeadModel.aggregate([
    { $match: base },
    { $group: { _id: "$stage", count: { $sum: 1 } } }
  ]);
  const counts = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as FecLeadStageCounts;
  for (const row of grouped) {
    if (row._id in counts) counts[row._id as FecLeadStage] = row.count;
  }

  const bucket = toStage(input.bucket);
  const total = bucket ? counts[bucket] : Object.values(counts).reduce((sum, n) => sum + n, 0);

  const leads = await FecLeadModel.find(bucket ? { ...base, stage: bucket } : base)
    .select("-history -last_event_id")
    .sort({ last_event_at: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    data: await toListItems(leads),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    counts
  };
}

export async function getFecLeadHistory(input: {
  leadGenId: string;
  customerScope: Record<string, unknown>;
}): Promise<{ lead: FecLeadListItem; history: FecLeadHistoryEntry[] }> {
  const lead = await FecLeadModel.findOne({
    lead_gen_id: input.leadGenId,
    isDeleted: false
  }).lean();
  if (!lead) throw new NotFoundException("Không tìm thấy hồ sơ FE Credit");

  const inScope = await CustomerModel.exists({
    $and: [
      { _id: new mongoose.Types.ObjectId(String(lead.customer_id)), isDeleted: false },
      input.customerScope
    ]
  });
  if (!inScope) throw new ForbiddenException("Bạn không có quyền xem hồ sơ này");

  const [item] = await toListItems([lead]);
  const history = [...(lead.history ?? [])]
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
    .map((h) => ({
      status: h.status,
      status_label: stepLabel(h.status),
      remark: h.remark ?? null,
      request_time: h.request_time ?? null,
      received_at: h.received_at,
      offer_amt: h.offer_amt ?? null,
      cash_amt: h.cash_amt ?? null,
      insurance_amt: h.insurance_amt ?? null,
      topup_amt: h.topup_amt ?? null
    }));

  return { lead: item, history };
}

export const MAX_EXPORT_ROWS = 5000;

export type FecLeadExportRow = Record<string, string | number>;

const formatVietnamDateTime = (value?: Date | string | null): string =>
  value
    ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
    : "";

// Các dòng để xuất Excel cho đúng nhóm/từ khoá đang xem (không phân trang), cùng phạm vi quyền như danh sách.
export async function exportFecLeadRows(
  input: Omit<ListFecLeadsInput, "page" | "limit">
): Promise<FecLeadExportRow[]> {
  const base = await buildLeadBaseFilter(input);
  const bucket = toStage(input.bucket);

  const leads = await FecLeadModel.find(bucket ? { ...base, stage: bucket } : base)
    .select("-history -last_event_id")
    .sort({ last_event_at: -1, _id: -1 })
    .limit(MAX_EXPORT_ROWS + 1)
    .lean();

  if (leads.length === 0)
    throw new ArgumentInvalidException("Không có dữ liệu khớp bộ lọc để xuất");
  if (leads.length > MAX_EXPORT_ROWS) {
    throw new ArgumentInvalidException(
      `Có hơn ${MAX_EXPORT_ROWS} hồ sơ khớp bộ lọc, vui lòng lọc bớt rồi xuất lại`
    );
  }

  const items = await toListItems(leads);
  return items.map((item, index) => ({
    STT: index + 1,
    "Họ tên": item.customer?.full_name ?? "",
    "Số điện thoại": item.customer?.phone_number ?? "",
    "Mã hồ sơ": item.lead_gen_id,
    "Giai đoạn": FEC_STAGE_LABELS[item.bucket] ?? item.bucket,
    "Đang ở bước": item.step_label,
    "Gợi ý cho Sale": item.advice,
    "Sale phụ trách": item.sale?.full_name ?? "",
    "Mã NV": item.sale?.ma_nv ?? "",
    "Gửi lúc": formatVietnamDateTime(item.created_at),
    "Cập nhật cuối": formatVietnamDateTime(item.last_event_at),
    "Số callback": item.callback_count,
    "Hạn mức đề nghị": item.offer_amt ?? "",
    "Giải ngân": item.cash_amt ?? ""
  }));
}

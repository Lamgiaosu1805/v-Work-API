import mongoose from "mongoose";
import CallLogModel from "../../models/CallLogModel";
import CustomerModel from "../../models/CustomerModel";
import InvestmentModel from "../../models/InvestmentModel";
import type { DateRange } from "../../modules/daily-report";

// Nguồn số tự động của báo cáo ngày (docs/CRM-DAILY-REPORT-FLOWS.md mục 4) — registry theo mã chỉ tiêu,
// giống mẫu `request-side-effects`. Mỗi nguồn trả số theo (Sale, TTKD lúc phát sinh); Sale null = "Chưa phân bổ".
// Đọc thẳng model (CQRS-lite), không ghi.

export interface AutoMetricRow {
  saleId: string | null;
  departmentId: string | null; // null = nguồn không chụp TTKD → workflow lấy TTKD hiện tại của Sale
  value: number;
}

export interface AutoMetricQuery {
  appId: string;
  range: DateRange;
  saleIds: string[] | null; // null = mọi Sale + "Chưa phân bổ"
}

type AutoMetricSource = (query: AutoMetricQuery) => Promise<AutoMetricRow[]>;

// Cùng ngưỡng "cuộc gọi hợp lệ" của Quy định 183A (valid_call_min_answer_sec mặc định)
const VALID_CALL_MIN_ANSWER_SEC = 20;

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const inRange = (range: DateRange) => ({ $gte: range.from, $lt: range.to });

const toRows = (groups: any[]): AutoMetricRow[] =>
  groups.map((g) => ({
    saleId: g._id?.s ? String(g._id.s) : null,
    departmentId: g._id?.d ? String(g._id.d) : null,
    value: g.value
  }));

/** Doanh số đầu tư (gross) theo ghi nhận `kpi_attribution` — trừ khoản bị huỷ. */
const investmentAmount: AutoMetricSource = async ({ appId, range, saleIds }) =>
  toRows(
    await InvestmentModel.aggregate([
      {
        $match: {
          app_id: oid(appId),
          isDeleted: false,
          status: { $ne: "cancelled" },
          invested_at: inRange(range),
          ...(saleIds ? { "kpi_attribution.sale_id": { $in: saleIds.map(oid) } } : {})
        }
      },
      {
        $group: {
          _id: { s: "$kpi_attribution.sale_id", d: "$kpi_attribution.department_id" },
          value: { $sum: "$amount" }
        }
      }
    ])
  );

/**
 * CIF theo ghi nhận `kpi_cif` (ngày được ghi nhận). Khách đăng ký trong kỳ nhưng không ghi nhận cho Sale nào
 * (marketing, kho chung, đại lý chưa gán Sale) → "Chưa phân bổ" để tổng khớp số đăng ký thực tế.
 */
const cifNew: AutoMetricSource = async ({ appId, range, saleIds }) => {
  const attributed = toRows(
    await CustomerModel.aggregate([
      {
        $match: {
          app_id: oid(appId),
          isDeleted: false,
          "kpi_cif.at": inRange(range),
          "kpi_cif.sale_id": saleIds ? { $in: saleIds.map(oid) } : { $ne: null }
        }
      },
      {
        $group: {
          _id: { s: "$kpi_cif.sale_id", d: "$kpi_cif.department_id" },
          value: { $sum: 1 }
        }
      }
    ])
  );
  if (saleIds) return attributed;

  const unassigned = await CustomerModel.countDocuments({
    app_id: oid(appId),
    isDeleted: false,
    registeredAt: inRange(range),
    $or: [{ kpi_cif: null }, { "kpi_cif.sale_id": null }]
  });
  return unassigned
    ? [...attributed, { saleId: null, departmentId: null, value: unassigned }]
    : attributed;
};

/** Khách có khoản đầu tư đầu tiên (không tính khoản huỷ) rơi vào kỳ — ghi cho Sale của khoản đầu tiên đó. */
const cifFirstInvestment: AutoMetricSource = async ({ appId, range, saleIds }) =>
  toRows(
    await InvestmentModel.aggregate(
      [
        {
          $match: {
            app_id: oid(appId),
            isDeleted: false,
            status: { $ne: "cancelled" },
            invested_at: { $lt: range.to }
          }
        },
        { $sort: { invested_at: 1 } },
        {
          $group: {
            _id: "$customer_id",
            first_at: { $first: "$invested_at" },
            s: { $first: "$kpi_attribution.sale_id" },
            d: { $first: "$kpi_attribution.department_id" }
          }
        },
        {
          $match: {
            first_at: { $gte: range.from },
            ...(saleIds ? { s: { $in: saleIds.map(oid) } } : {})
          }
        },
        { $group: { _id: { s: "$s", d: "$d" }, value: { $sum: 1 } } }
      ],
      { allowDiskUse: true }
    )
  );

/** Cuộc gọi ra qua OMICall, khách nghe máy ≥ 20 giây. call_log không chụp TTKD → lấy TTKD hiện tại. */
const telesaleCall: AutoMetricSource = async ({ range, saleIds }) =>
  toRows(
    await CallLogModel.aggregate([
      {
        $match: {
          direction: "outbound",
          isDeleted: false,
          sale_id: saleIds ? { $in: saleIds.map(oid) } : { $ne: null },
          time_start_call: inRange(range),
          answer_sec: { $gte: VALID_CALL_MIN_ANSWER_SEC }
        }
      },
      { $group: { _id: { s: "$sale_id" }, value: { $sum: 1 } } }
    ])
  );

export const AUTO_METRIC_SOURCES: Record<string, AutoMetricSource> = {
  investment_amount: investmentAmount,
  cif_new: cifNew,
  cif_first_investment: cifFirstInvestment,
  telesale_call: telesaleCall
};

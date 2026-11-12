import moment from "moment-timezone";
import UserInfoModel from "../models/UserInfoModel";
import EmploymentStatusModel from "../models/EmploymentStatusModel";
import { RequestModel } from "../models/RequestModel";
import { NotFoundException } from "../core/exceptions/exceptions";
import { isResignedAt } from "../shared-kernel/resignation";
import {
  ADVANCE_BORROW_MAX_DAYS,
  AUTO_REJECT_AFTER_DAYS,
  MONTHLY_ACCRUAL,
  RETROACTIVE_LIMIT_DAYS
} from "../config/common/leaveConfig";
import {
  getLeaveBalance,
  getLeaveYearData,
  paginateLeaveEntries,
  parseLeaveLedgerType,
  parseLeaveYear,
  summarizeLeaveYear
} from "../modules/leave";

const TZ = "Asia/Ho_Chi_Minh";

interface MyLeaveQuery {
  year?: unknown;
  type?: unknown;
  page?: unknown;
  limit?: unknown;
}

async function loadEmployee(accountId: string) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false })
    .select("_id employment_status resignation_date")
    .lean();
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");
  return userInfo as any;
}

// Màn "Phép của tôi" — thẻ tổng quan + điều kiện hợp đồng. Chỉ đọc, chỉ trả dữ liệu của chính người gọi.
export async function getMyLeaveOverview(accountId: string, query: MyLeaveQuery) {
  const year = parseLeaveYear(query.year);
  const user = await loadEmployee(accountId);
  const userId = String(user._id);

  const [status, balance, yearData, pending] = await Promise.all([
    user.employment_status
      ? EmploymentStatusModel.findOne({ _id: user.employment_status, isDeleted: false }).lean()
      : null,
    getLeaveBalance(userId),
    getLeaveYearData(userId, year),
    // Phép bị trừ ngay khi tạo đơn, nên số dư đã loại phần đang chờ duyệt — trả riêng để màn hình giải thích.
    RequestModel.aggregate([
      {
        $match: {
          user_id: user._id,
          request_type: "leave",
          status: "pending",
          isDeleted: false
        }
      },
      { $group: { _id: null, total: { $sum: "$paid_days" } } }
    ])
  ]);

  const accrues = Boolean((status as any)?.accrues_annual_leave);
  const canUse = Boolean((status as any)?.can_use_annual_leave);
  const resigned = isResignedAt(user, new Date());
  const { used, added } = summarizeLeaveYear(yearData.entries);

  return {
    year,
    balance,
    used,
    added,
    pending_days: pending[0]?.total ?? 0,
    monthly_accrual: MONTHLY_ACCRUAL,
    advance_borrow_max_days: ADVANCE_BORROW_MAX_DAYS,
    retroactive_limit_days: RETROACTIVE_LIMIT_DAYS,
    auto_reject_after_days: AUTO_REJECT_AFTER_DAYS,
    next_accrual_date:
      accrues && !resigned
        ? moment.tz(TZ).add(1, "month").startOf("month").format("YYYY-MM-DD")
        : null,
    eligibility: {
      employment_status_name: (status as any)?.name ?? null,
      accrues_annual_leave: accrues,
      can_use_annual_leave: canUse
    }
  };
}

// Lịch sử biến động theo năm: mới → cũ, lọc theo chiều biến động, phân trang, kèm số dư luỹ kế và đơn liên quan.
export async function getMyLeaveLedger(accountId: string, query: MyLeaveQuery) {
  const year = parseLeaveYear(query.year);
  const type = parseLeaveLedgerType(query.type);
  const user = await loadEmployee(accountId);

  const yearData = await getLeaveYearData(String(user._id), year);
  const page = paginateLeaveEntries(yearData.entries, type, query);

  const requestIds = page.data
    .filter((e) => e.refType === "request" && e.refId)
    .map((e) => e.refId as string);

  const requests = requestIds.length
    ? await RequestModel.find({ _id: { $in: requestIds }, user_id: user._id })
        .select("from_date from_period to_date to_period total_days status")
        .lean()
    : [];
  const requestById = new Map((requests as any[]).map((r) => [String(r._id), r]));

  return {
    year,
    data: page.data.map((e) => {
      const r = e.refId ? requestById.get(e.refId) : undefined;
      return {
        _id: e.id,
        created_at: e.createdAt,
        reason: e.reason,
        amount: e.amount,
        balance_after: e.balanceAfter,
        note: e.note,
        ref_type: e.refType,
        request: r
          ? {
              _id: String(r._id),
              from_date: r.from_date,
              from_period: r.from_period,
              to_date: r.to_date,
              to_period: r.to_period,
              total_days: r.total_days,
              status: r.status
            }
          : null
      };
    }),
    pagination: page.pagination
  };
}

import moment from "moment-timezone";
import { LEAVE_BALANCE_REASON } from "../../../constants";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";
import { EmployeeId } from "../../../shared-kernel/employee-id";
import { LeaveBalanceRepository, LeaveLedgerRow } from "../infrastructure/leave-balance.repository";

const TZ = "Asia/Ho_Chi_Minh";
const MIN_YEAR = 2000;

const repository = new LeaveBalanceRepository();

export type LeaveLedgerType = "all" | "in" | "out";

export interface LeaveLedgerEntry extends LeaveLedgerRow {
  // Số dư ngay sau dòng này, cộng dồn từ TOÀN BỘ lịch sử (không phải chỉ trong năm đang xem).
  balanceAfter: number;
}

export interface LeaveYearData {
  year: number;
  openingBalance: number;
  entries: LeaveLedgerEntry[];
}

export interface LeaveYearSummary {
  used: number;
  added: number;
}

// Tránh sai số số thực khi cộng dồn nửa ngày (0.1 + 0.2...).
const round = (n: number) => Math.round(n * 100) / 100;

export function currentLeaveYear(now: Date = new Date()): number {
  return moment.tz(now, TZ).year();
}

export function parseLeaveYear(raw: unknown, now: Date = new Date()): number {
  if (raw === undefined || raw === null || raw === "") return currentLeaveYear(now);
  const year = Number(raw);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > currentLeaveYear(now) + 1) {
    throw new ArgumentInvalidException("Năm không hợp lệ");
  }
  return year;
}

export function parseLeaveLedgerType(raw: unknown): LeaveLedgerType {
  if (raw === undefined || raw === null || raw === "" || raw === "all") return "all";
  if (raw === "in" || raw === "out") return raw;
  throw new ArgumentInvalidException("Loại biến động không hợp lệ");
}

// Số dư luỹ kế gắn vào từng dòng, tính từ số dư đầu năm + các dòng trong năm theo thứ tự ghi sổ.
// Không dùng cột balance_after đã lưu: job cộng phép tháng không ghi cột này.
export function attachRunningBalance(
  openingBalance: number,
  rows: LeaveLedgerRow[]
): LeaveLedgerEntry[] {
  let balance = openingBalance;
  return rows.map((row) => {
    balance = round(balance + row.amount);
    return { ...row, balanceAfter: balance };
  });
}

// "Đã dùng" = phép bị trừ vì đơn nghỉ, đã trừ phần được hoàn (từ chối/huỷ/chấm công đè ngày nghỉ).
// "Đã cộng" = các dòng dương còn lại (cộng tháng, HR điều chỉnh, truy lĩnh).
const USAGE_REASONS: string[] = [
  LEAVE_BALANCE_REASON.LEAVE_REQUEST_DEDUCTION,
  LEAVE_BALANCE_REASON.REJECT_REFUND,
  LEAVE_BALANCE_REASON.CANCEL_REFUND,
  LEAVE_BALANCE_REASON.AUTO_REJECT_REFUND,
  LEAVE_BALANCE_REASON.ATTENDANCE_OVERRIDE_REFUND
];

export function summarizeLeaveYear(entries: LeaveLedgerEntry[]): LeaveYearSummary {
  let used = 0;
  let added = 0;
  entries.forEach((e) => {
    if (USAGE_REASONS.includes(e.reason)) used -= e.amount;
    else if (e.amount > 0) added += e.amount;
  });
  return { used: round(used), added: round(added) };
}

export async function getLeaveYearData(userId: string, year: number): Promise<LeaveYearData> {
  const employeeId = EmployeeId.of(userId);
  const from = moment.tz({ year }, TZ).startOf("year").toDate();
  const to = moment.tz({ year }, TZ).add(1, "year").startOf("year").toDate();

  const [openingBalance, rows] = await Promise.all([
    repository.sumBefore(employeeId, from),
    repository.findInRange(employeeId, from, to)
  ]);

  return {
    year,
    openingBalance: round(openingBalance),
    entries: attachRunningBalance(openingBalance, rows)
  };
}

export interface LeaveLedgerPage {
  data: LeaveLedgerEntry[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}

// Mới → cũ, lọc theo chiều biến động rồi phân trang. Số dư luỹ kế đã gắn trước khi lọc nên không lệch.
export function paginateLeaveEntries(
  entries: LeaveLedgerEntry[],
  type: LeaveLedgerType,
  query: PaginationQuery
): LeaveLedgerPage {
  const { page, limit, skip } = parsePagination(query);
  const filtered = entries
    .filter((e) => type === "all" || (type === "in" ? e.amount > 0 : e.amount < 0))
    .reverse();

  return {
    data: filtered.slice(skip, skip + limit),
    pagination: {
      total: filtered.length,
      page,
      limit,
      total_pages: Math.ceil(filtered.length / limit)
    }
  };
}

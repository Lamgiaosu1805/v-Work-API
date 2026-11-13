// Use-case ĐỌC (CQRS-lite): ngày nghỉ phép CẢ NGÀY (đơn đã duyệt) của nhân viên —
// dùng để miễn báo cáo ngày kinh doanh (workflows/daily-report-board.workflow.ts).
import moment from "moment-timezone";
import WorkDayStatusModel from "../../../models/WorkDayStatusModel";

const TZ = "Asia/Ho_Chi_Minh";
const LEAVE_STATUSES = ["leave_paid", "leave_unpaid"];

/** userId → tập ngày (YYYY-MM-DD) nghỉ cả ngày trong khoảng [from, to). */
export async function listFullLeaveDays(
  userIds: string[],
  from: Date,
  to: Date
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (!userIds.length) return result;

  const rows = (await WorkDayStatusModel.find({
    user_id: { $in: userIds },
    date: { $gte: from, $lt: to },
    status: { $in: LEAVE_STATUSES },
    isDeleted: false
  })
    .select("user_id date period")
    .lean()) as { user_id: unknown; date: Date; period: string }[];

  const periodsByDay = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const key = `${String(row.user_id)}|${moment.tz(row.date, TZ).format("YYYY-MM-DD")}`;
    if (!periodsByDay.has(key)) periodsByDay.set(key, new Set());
    periodsByDay.get(key)!.add(row.period);
  });

  periodsByDay.forEach((periods, key) => {
    if (!periods.has("full") && !(periods.has("morning") && periods.has("afternoon"))) return;
    const [userId, day] = key.split("|");
    if (!result.has(userId)) result.set(userId, new Set());
    result.get(userId)!.add(day);
  });
  return result;
}

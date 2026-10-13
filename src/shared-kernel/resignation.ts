import moment from "moment-timezone";

const APP_TIMEZONE = "Asia/Ho_Chi_Minh";

// "Ngày nghỉ việc" (UserInfo.resignation_date) = ngày làm việc CUỐI CÙNG của nhân sự, lưu ở
// 23:59:59.999 giờ VN ngày đó: ngày đó vẫn có bảng công và tính công, từ ngày hôm sau mới coi là đã
// nghỉ. Mọi chỗ cần biết "đã nghỉ chưa" so sánh mốc này với 1 thời điểm, không dùng cờ đúng/sai —
// nhờ vậy nghỉ giữa kỳ, đặt trước ngày nghỉ hay nhập lùi ngày đều tính đúng. CRM (customer-care) cũng
// đang dùng đúng quy ước này (`resignation_date <= now` → đã nghỉ).

type WithResignation = { resignation_date?: Date | string | null };

/** Tại thời điểm `at`, nhân sự đã nghỉ việc chưa (đã qua hết ngày làm việc cuối cùng). */
export function isResignedAt(user: WithResignation, at: Date | string): boolean {
  if (!user.resignation_date) return false;
  return new Date(user.resignation_date).getTime() < new Date(at).getTime();
}

/** Điều kiện Mongo: nhân sự còn làm việc tại thời điểm `at` (chưa có ngày nghỉ, hoặc chưa hết ngày nghỉ). */
export function stillEmployedAtFilter(at: Date): Record<string, unknown> {
  return { $or: [{ resignation_date: null }, { resignation_date: { $gte: at } }] };
}

/** Điều kiện Mongo: nhân sự đã nghỉ việc tại thời điểm `at`. */
export function resignedAtFilter(at: Date): Record<string, unknown> {
  return { resignation_date: { $ne: null, $lt: at } };
}

/** "YYYY-MM-DD" → 23:59:59.999 giờ VN của ngày đó (cuối ngày làm việc cuối cùng); null nếu sai định dạng. */
export function parseResignationDate(value: string): Date | null {
  const parsed = moment.tz(value, "YYYY-MM-DD", true, APP_TIMEZONE);
  return parsed.isValid() ? parsed.endOf("day").toDate() : null;
}

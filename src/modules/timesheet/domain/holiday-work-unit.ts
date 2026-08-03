import moment from "moment-timezone";

const TZ = "Asia/Ho_Chi_Minh";

// Gap SRS phát hiện (trang 11, "Công thực tế"): "Nếu ngày lễ được cài trong hệ thống → mặc định
// hiển thị 1 ngày công" — chỉ áp dụng cho holiday pay_policy="paid", KHÔNG ghi đè worksheet đã có sẵn
// (chỉ điền vào ngày hoàn toàn chưa có dữ liệu). Chủ nhật vốn đã không phải ngày công chuẩn (khớp quy
// ước của calcStandardWorkUnits) nên không tính default cho ngày lễ rơi vào Chủ nhật.
export interface HolidaySnapshot {
  date: Date;
  pay_policy: "paid" | "unpaid";
  scope_type: "all" | "branch";
  branches: string[];
}

export function buildHolidayDefaultWorkUnitMap(
  holidays: HolidaySnapshot[],
  branchId: string | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const h of holidays) {
    if (h.pay_policy !== "paid") continue;
    const inScope = h.scope_type === "all" || (!!branchId && h.branches.includes(branchId));
    if (!inScope) continue;

    const dateMoment = moment.tz(h.date, TZ);
    const dayOfWeek = dateMoment.day();
    if (dayOfWeek === 0) continue; // Chủ nhật vốn không phải ngày công chuẩn

    map.set(dateMoment.format("YYYY-MM-DD"), dayOfWeek === 6 ? 0.5 : 1);
  }
  return map;
}

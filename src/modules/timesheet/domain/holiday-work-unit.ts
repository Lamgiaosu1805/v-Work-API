import moment from "moment-timezone";

const TZ = "Asia/Ho_Chi_Minh";

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
    if (dayOfWeek === 0) continue;

    map.set(dateMoment.format("YYYY-MM-DD"), dayOfWeek === 6 ? 0.5 : 1);
  }
  return map;
}

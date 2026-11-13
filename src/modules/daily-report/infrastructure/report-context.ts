// Nạp app + ngày lễ cho module daily-report. Đọc thẳng AppModel/HolidayModel (đọc, không ghi — CQRS-lite),
// giống module customer-care.
import moment from "moment-timezone";
import AppModel from "../../../models/AppModel";
import HolidayModel from "../../../models/HolidayModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { REPORT_TZ, addDays } from "../domain/report-calendar";

export async function requireAppId(appCode: string): Promise<string> {
  const app = (await AppModel.findOne({ code: appCode, isDeleted: false })
    .select("_id")
    .lean()) as { _id: unknown } | null;
  if (!app) throw new NotFoundException(`Không tìm thấy app "${appCode}"`);
  return String(app._id);
}

/** Ngày lễ toàn công ty (YYYY-MM-DD) trong đoạn [fromKey, toKey]. */
export async function loadHolidayKeys(fromKey: string, toKey: string): Promise<Set<string>> {
  const holidays = (await HolidayModel.find({
    isDeleted: false,
    scope_type: "all",
    date: {
      $gte: moment.tz(addDays(fromKey, -10), REPORT_TZ).toDate(),
      $lt: moment.tz(addDays(toKey, 1), REPORT_TZ).toDate()
    }
  })
    .select("date duration_days")
    .lean()) as { date: Date; duration_days?: number }[];

  const keys = new Set<string>();
  holidays.forEach((holiday) => {
    const first = moment.tz(holiday.date, REPORT_TZ).format("YYYY-MM-DD");
    const days = Math.max(1, Math.ceil(holiday.duration_days ?? 1));
    for (let i = 0; i < days; i += 1) keys.add(addDays(first, i));
  });
  return keys;
}

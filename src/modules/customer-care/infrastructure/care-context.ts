// Nạp chính sách + lịch làm việc cho module customer-care. Đọc thẳng AppModel/HolidayModel (đọc,
// không ghi — CQRS-lite), giống cách module customer-call đọc CustomerModel.
import AppModel from "../../../models/AppModel";
import HolidayModel from "../../../models/HolidayModel";
import CustomerCarePolicyModel from "../../../models/CustomerCarePolicyModel";
import { buildCarePolicy, CarePolicy } from "../domain/care-policy";
import { WorkingCalendar, toVnDateKey } from "../domain/working-calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

export function policyFromDoc(appCode: string, doc: any | null): CarePolicy {
  if (!doc) return buildCarePolicy(appCode);
  const sla = (cls: "A" | "B") => {
    const s = doc.sla?.[cls];
    if (!s) return undefined;
    return Object.fromEntries(
      Object.entries({
        firstContactMinutes: s.first_contact_minutes,
        warnMinutes: s.warn_minutes,
        revokeMinutes: s.revoke_minutes,
        inactivityMinutes: s.inactivity_minutes,
        minAttemptsIfNotConnected: s.min_attempts_if_not_connected
      }).filter(([, v]) => v !== undefined && v !== null)
    );
  };
  const caps = Object.fromEntries(
    (["A", "B", "C", "D"] as const)
      .filter((rank) => doc.capacity_by_rank?.[rank])
      .map((rank) => [
        rank,
        {
          newPerDay: doc.capacity_by_rank[rank].new_per_day,
          total: doc.capacity_by_rank[rank].total
        }
      ])
  );
  const overrides = Object.fromEntries(
    Object.entries({
      enabled: doc.enabled,
      validCallMinAnswerSec: doc.valid_call_min_answer_sec,
      maxSaleRounds: doc.max_sale_rounds,
      appointmentGraceMinutes: doc.appointment_grace_minutes,
      defaultRank: doc.default_rank,
      autoRevokeReferral: doc.auto_revoke_referral,
      workStartMinute: doc.work_start_minute,
      workEndMinute: doc.work_end_minute
    }).filter(([, v]) => v !== undefined && v !== null)
  );
  return buildCarePolicy(appCode, {
    ...overrides,
    sla: { A: sla("A"), B: sla("B") } as never,
    capacityByRank: caps as never
  });
}

export function policyToDoc(policy: CarePolicy) {
  const sla = (cls: "A" | "B") => ({
    first_contact_minutes: policy.sla[cls].firstContactMinutes,
    warn_minutes: policy.sla[cls].warnMinutes,
    revoke_minutes: policy.sla[cls].revokeMinutes,
    inactivity_minutes: policy.sla[cls].inactivityMinutes,
    min_attempts_if_not_connected: policy.sla[cls].minAttemptsIfNotConnected
  });
  return {
    app_code: policy.appCode,
    enabled: policy.enabled,
    sla: { A: sla("A"), B: sla("B") },
    valid_call_min_answer_sec: policy.validCallMinAnswerSec,
    max_sale_rounds: policy.maxSaleRounds,
    appointment_grace_minutes: policy.appointmentGraceMinutes,
    capacity_by_rank: Object.fromEntries(
      Object.entries(policy.capacityByRank).map(([rank, cap]) => [
        rank,
        { new_per_day: cap.newPerDay, total: cap.total }
      ])
    ),
    default_rank: policy.defaultRank,
    auto_revoke_referral: policy.autoRevokeReferral,
    work_start_minute: policy.workStartMinute,
    work_end_minute: policy.workEndMinute
  };
}

/** Chính sách theo app_code. null = app chưa được bật phạm vi chăm sóc khách (chưa có cấu hình). */
export async function loadCarePolicy(appCode: string): Promise<CarePolicy | null> {
  const doc = await CustomerCarePolicyModel.findOne({ app_code: appCode, isDeleted: false }).lean();
  return doc ? policyFromDoc(appCode, doc) : null;
}

export async function loadCarePolicyByAppId(appId: string): Promise<CarePolicy | null> {
  const app = (await AppModel.findById(appId).select("code").lean()) as { code?: string } | null;
  if (!app?.code) return null;
  return loadCarePolicy(app.code);
}

export async function resolveAppId(appCode: string): Promise<string | null> {
  const app = (await AppModel.findOne({ code: appCode }).select("_id").lean()) as {
    _id: unknown;
  } | null;
  return app ? String(app._id) : null;
}

/** Ngày lễ áp toàn công ty trong khoảng [from - 7 ngày, from + 60 ngày]. */
export async function loadWorkingCalendar(
  policy: CarePolicy,
  from: Date
): Promise<WorkingCalendar> {
  const holidays = (await HolidayModel.find({
    isDeleted: false,
    scope_type: "all",
    date: {
      $gte: new Date(from.getTime() - 7 * DAY_MS),
      $lte: new Date(from.getTime() + 60 * DAY_MS)
    }
  })
    .select("date duration_days")
    .lean()) as { date: Date; duration_days?: number }[];

  const keys: string[] = [];
  holidays.forEach((holiday) => {
    const days = Math.max(1, Math.ceil(holiday.duration_days ?? 1));
    for (let i = 0; i < days; i += 1) {
      keys.push(toVnDateKey(new Date(new Date(holiday.date).getTime() + i * DAY_MS)));
    }
  });

  return new WorkingCalendar({
    workStartMinute: policy.workStartMinute,
    workEndMinute: policy.workEndMinute,
    holidays: keys
  });
}

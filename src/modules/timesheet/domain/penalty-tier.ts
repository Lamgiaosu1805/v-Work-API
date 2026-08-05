import moment from "moment-timezone";
import { PenaltyOutcome } from "./types";

const TZ = "Asia/Ho_Chi_Minh";

export type PenaltyTierType = "late" | "early" | "forgot";
export type PenaltyKind = "money" | "work_unit" | "half_day_money" | "full_day_money";

export interface PenaltyTier {
  from_minutes: number | null;
  to_minutes: number | null;
  from_count: number | null;
  to_count: number | null;
  penalty_kind: PenaltyKind;
  penalty_value: number;
  effective_from: Date;
}

function findApplicableGeneration(tiers: PenaltyTier[], dateObj: Date): number | null {
  const generations = [...new Set(tiers.map((t) => t.effective_from.getTime()))].sort(
    (a, b) => b - a
  );
  return generations.find((g) => g <= dateObj.getTime()) ?? null;
}

export function resolveLatePenaltyFromTiers(
  tiers: PenaltyTier[],
  dateObj: Date,
  minutesLate: number,
  isSaturday: boolean
): PenaltyOutcome {
  const base = isSaturday ? 0.5 : 1;

  if (!minutesLate || minutesLate <= 0)
    return { work_unit: base, penalty_amount: 0, morning_absent: false };

  const genTime = findApplicableGeneration(tiers, dateObj);
  if (genTime == null) return { work_unit: base, penalty_amount: 0, morning_absent: false };

  const genTiers = tiers.filter((t) => t.effective_from.getTime() === genTime);
  const tier = genTiers.find(
    (t) =>
      minutesLate >= (t.from_minutes ?? 0) && (t.to_minutes == null || minutesLate <= t.to_minutes)
  );

  if (!tier) return { work_unit: 0.5, penalty_amount: 0, morning_absent: true };

  if (tier.penalty_kind === "money")
    return { work_unit: base, penalty_amount: tier.penalty_value, morning_absent: false };

  if (tier.penalty_kind === "half_day_money")
    return { work_unit: 0.5, penalty_amount: tier.penalty_value, morning_absent: true };

  if (tier.penalty_kind === "full_day_money")
    return { work_unit: 0, penalty_amount: tier.penalty_value, morning_absent: true };

  return {
    work_unit: Math.max(0, base - tier.penalty_value),
    penalty_amount: 0,
    morning_absent: false
  };
}

export function resolveEarlyPenaltyFromTiers(
  tiers: PenaltyTier[],
  dateObj: Date,
  minutesEarly: number,
  isSaturday: boolean
): PenaltyOutcome {
  const base = isSaturday ? 0.5 : 1;

  if (!minutesEarly || minutesEarly <= 0)
    return { work_unit: base, penalty_amount: 0, afternoon_absent: false };

  const genTime = findApplicableGeneration(tiers, dateObj);
  if (genTime == null) return { work_unit: base, penalty_amount: 0, afternoon_absent: false };

  const genTiers = tiers.filter((t) => t.effective_from.getTime() === genTime);
  const tier = genTiers.find(
    (t) =>
      minutesEarly >= (t.from_minutes ?? 0) &&
      (t.to_minutes == null || minutesEarly <= t.to_minutes)
  );

  if (!tier) return { work_unit: 0.5, penalty_amount: 0, afternoon_absent: true };

  if (tier.penalty_kind === "money")
    return { work_unit: base, penalty_amount: tier.penalty_value, afternoon_absent: false };

  if (tier.penalty_kind === "half_day_money")
    return { work_unit: 0.5, penalty_amount: tier.penalty_value, afternoon_absent: true };

  if (tier.penalty_kind === "full_day_money")
    return { work_unit: 0, penalty_amount: tier.penalty_value, afternoon_absent: true };

  return {
    work_unit: Math.max(0, base - tier.penalty_value),
    penalty_amount: 0,
    afternoon_absent: false
  };
}

export function resolveForgotPenaltyFromTiers(
  tiers: PenaltyTier[],
  dateObj: Date,
  count: number,
  isSaturday: boolean
): PenaltyOutcome {
  const base = isSaturday ? 0.5 : 1;

  if (!count || count <= 0) return { work_unit: base, penalty_amount: 0 };

  const genTime = findApplicableGeneration(tiers, dateObj);
  if (genTime == null) return { work_unit: base, penalty_amount: 0 };

  const genTiers = tiers.filter((t) => t.effective_from.getTime() === genTime);
  const tier = genTiers.find(
    (t) => count >= (t.from_count ?? 0) && (t.to_count == null || count <= t.to_count)
  );

  if (!tier) return { work_unit: base, penalty_amount: 0 };

  if (tier.penalty_kind === "money") return { work_unit: base, penalty_amount: tier.penalty_value };

  return { work_unit: base / 2, penalty_amount: 0 };
}

export interface ForgotDaySnapshot {
  dateKey: string;
  hasIn: boolean;
  hasOut: boolean;
  leaveMorning: boolean;
  leaveAfternoon: boolean;
}

export interface ForgotOccurrenceEntry {
  occurrence: number;
  hasRequest: boolean;
}

export interface BuildUnifiedForgotOccurrenceMapInput {
  approvedForgotRequests?: { date: Date }[];
  daySnapshots?: ForgotDaySnapshot[];
}

export function buildUnifiedForgotOccurrenceMap({
  approvedForgotRequests,
  daySnapshots
}: BuildUnifiedForgotOccurrenceMapInput): Map<string, ForgotOccurrenceEntry> {
  const requestDateKeys = new Set(
    (approvedForgotRequests || []).map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
  );

  const autoDateKeys = (daySnapshots || [])
    .filter((d) => {
      if (requestDateKeys.has(d.dateKey)) return false;
      const missedIn = !d.hasIn && !d.leaveMorning;
      const missedOut = !d.hasOut && !d.leaveAfternoon;
      const isPartial = (d.hasIn && !d.hasOut) || (!d.hasIn && d.hasOut);
      return isPartial && (missedIn || missedOut);
    })
    .map((d) => d.dateKey);

  const merged = [
    ...[...requestDateKeys].map((dateKey) => ({ dateKey, hasRequest: true })),
    ...autoDateKeys.map((dateKey) => ({ dateKey, hasRequest: false }))
  ].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const map = new Map<string, ForgotOccurrenceEntry>();
  merged.forEach((item, idx) => {
    map.set(item.dateKey, { occurrence: idx + 1, hasRequest: item.hasRequest });
  });
  return map;
}

// Phép tính tiến độ theo mẫu KPI 13 cột (docs/CRM-DAILY-SALES-REPORT-PLAN.md mục 2.4).

export interface PeriodValues {
  day: number;
  mtd: number; // lũy kế tháng
  ytd: number; // lũy kế năm
}

export const emptyPeriodValues = (): PeriodValues => ({ day: 0, mtd: 0, ytd: 0 });

export function addInto(target: PeriodValues, source: PeriodValues): PeriodValues {
  target.day += source.day;
  target.mtd += source.mtd;
  target.ytd += source.ytd;
  return target;
}

export interface MetricTarget {
  annual: number;
  monthly?: number[] | null;
}

/** KH tháng: lấy theo phân bổ tháng nếu đủ 12 tháng, ngược lại chia đều KH năm. */
export function monthlyTarget(target: MetricTarget, month: number): number {
  const monthly = target.monthly ?? [];
  if (monthly.length === 12 && Number.isFinite(monthly[month - 1])) return monthly[month - 1];
  return target.annual / 12;
}

/** Tỷ lệ hoàn thành; không có kế hoạch (hoặc kế hoạch = 0) → null. */
export function completionRatio(actual: number, target: number | null | undefined): number | null {
  if (target === null || target === undefined || !(target > 0)) return null;
  return actual / target;
}

/** Số còn thiếu = max(0, KH − TH); không có kế hoạch → null. */
export function shortfall(actual: number, target: number | null | undefined): number | null {
  if (target === null || target === undefined) return null;
  return Math.max(0, target - actual);
}

/**
 * "Cần đạt hôm nay" = (KH tháng − TH tháng đến hết hôm qua) / số ngày phải báo cáo còn lại tính cả hôm nay.
 */
export function suggestedDailyTarget(input: {
  monthTarget: number | null;
  doneBeforeToday: number;
  reportDaysLeft: number;
}): number | null {
  if (input.monthTarget === null || input.reportDaysLeft <= 0) return null;
  return Math.max(0, (input.monthTarget - input.doneBeforeToday) / input.reportDaysLeft);
}

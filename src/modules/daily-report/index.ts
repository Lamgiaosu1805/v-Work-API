// Public API module daily-report — báo cáo ngày kinh doanh + kế hoạch KPI năm.
// Xem docs/CRM-DAILY-REPORT-FLOWS.md.
export {
  saveDailyReportPlan,
  submitDailyReportResult
} from "./application/daily-report-commands.service";
export type { ReportWriteContext } from "./application/daily-report-commands.service";
export { listKpiPlans, listDailyReports } from "./application/daily-report-queries.service";
export type {
  KpiPlanView,
  DailyReportView,
  MetricValueView
} from "./application/daily-report-queries.service";
export { requireAppId, loadHolidayKeys } from "./infrastructure/report-context";
export {
  METRICS,
  METRIC_ORDER,
  AUTO_METRIC_CODES,
  KPI_TEMPLATES,
  DEFAULT_TEMPLATE,
  templateMetrics,
  manualMetrics,
  plannableMetrics,
  targetMetrics,
  aggregationOf
} from "./domain/kpi-metrics";
export type {
  MetricCode,
  MetricDef,
  MetricAggregation,
  KpiTemplateCode
} from "./domain/kpi-metrics";
export {
  REPORT_DEADLINES,
  toDateKey,
  parseDateKey,
  addDays,
  periodRanges,
  monthOf,
  yearOf,
  endOfMonthKey,
  deadlineOf,
  isReportDay,
  reportDaysBetween,
  submissionStatus,
  bucketsEndingAt
} from "./domain/report-calendar";
export type {
  DateRange,
  SubmissionStatus,
  TrendGranularity,
  PeriodBucket
} from "./domain/report-calendar";
export {
  emptyPeriodValues,
  addInto,
  monthlyTarget,
  completionRatio,
  shortfall,
  suggestedDailyTarget
} from "./domain/kpi-progress";
export type { PeriodValues, MetricTarget } from "./domain/kpi-progress";

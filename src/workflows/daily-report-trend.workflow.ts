import { resolveSaleUnitIds } from "../helpers/kpiAttribution";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";
import type { Ability } from "../modules/permission";
import {
  METRICS,
  METRIC_ORDER,
  aggregationOf,
  bucketsEndingAt,
  completionRatio,
  listDailyReports,
  requireAppId
} from "../modules/daily-report";
import type { MetricCode, TrendGranularity } from "../modules/daily-report";
import { AUTO_METRIC_SOURCES, AutoMetricRow } from "./daily-report/auto-metric-sources";
import { loadUnitTree, viewerScope } from "./daily-report/unit-tree";
import { DAILY_REPORT_DEFAULT_APP } from "./daily-report-board.workflow";

// Xu hướng 1 chỉ tiêu theo tuần/tháng cho mọi đơn vị trong phạm vi xem — phục vụ so sánh TTKD
// (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 2). Cộng dồn lên cây giống bảng tổng hợp.

const DEFAULT_PERIODS: Record<TrendGranularity, number> = { week: 8, month: 6 };
const MAX_PERIODS = 24;

const MANUAL_METRICS = METRIC_ORDER.filter((code) => METRICS[code].source === "manual");
export const TREND_METRICS: string[] = [
  ...Object.keys(AUTO_METRIC_SOURCES),
  "net_growth",
  ...MANUAL_METRICS
];

async function rowsForBucket(
  metric: string,
  appId: string,
  range: { from: Date; to: Date }
): Promise<AutoMetricRow[]> {
  if (metric !== "net_growth") return AUTO_METRIC_SOURCES[metric]({ appId, range, saleIds: null });
  const [inflow, outflow] = await Promise.all([
    AUTO_METRIC_SOURCES.investment_amount({ appId, range, saleIds: null }),
    AUTO_METRIC_SOURCES.investment_outflow({ appId, range, saleIds: null })
  ]);
  return [...inflow, ...outflow.map((row) => ({ ...row, value: -row.value }))];
}

export async function getDailyReportTrend(input: {
  ability: Ability;
  metric: string;
  granularity: TrendGranularity;
  toKey: string;
  periods?: number;
  appCode?: string;
}) {
  if (!TREND_METRICS.includes(input.metric)) {
    throw new ArgumentInvalidException(`Chỉ tiêu "${input.metric}" chưa hỗ trợ xu hướng`);
  }
  if (!["week", "month"].includes(input.granularity)) {
    throw new ArgumentInvalidException("granularity phải là week hoặc month");
  }
  const count = Math.min(
    MAX_PERIODS,
    Math.max(2, Math.floor(input.periods || DEFAULT_PERIODS[input.granularity]))
  );
  const appCode = input.appCode || DAILY_REPORT_DEFAULT_APP;
  const appId = await requireAppId(appCode);
  const buckets = bucketsEndingAt(input.toKey, input.granularity, count);
  const { companyWide, canSee } = viewerScope(input.ability);

  let bucketRows: AutoMetricRow[][];
  if (MANUAL_METRICS.includes(input.metric as MetricCode)) {
    const reports = await listDailyReports(appId, buckets[0].fromKey, buckets[count - 1].toKey);
    bucketRows = buckets.map(() => []);
    reports.forEach((report) => {
      const index = buckets.findIndex(
        (b) => report.reportDate >= b.fromKey && report.reportDate <= b.toKey
      );
      const value = report.result.values.find((v) => v.metricCode === input.metric)?.value;
      if (index < 0 || !value) return;
      bucketRows[index].push({
        saleId: report.employeeId,
        departmentId: report.departmentId,
        value
      });
    });
  } else {
    bucketRows = await Promise.all(buckets.map((b) => rowsForBucket(input.metric, appId, b.range)));
  }

  const saleIds = [
    ...new Set(
      bucketRows
        .flat()
        .map((row) => row.saleId)
        .filter(Boolean) as string[]
    )
  ];
  const [unitIds, tree] = await Promise.all([resolveSaleUnitIds(saleIds), loadUnitTree()]);

  const ratio = aggregationOf(input.metric as MetricCode) === "ratio";
  const series = new Map<string, { values: number[]; bases: number[] }>();
  const totals = { values: buckets.map(() => 0), bases: buckets.map(() => 0) };
  const seriesOf = (unitId: string) => {
    if (!series.has(unitId)) {
      series.set(unitId, { values: buckets.map(() => 0), bases: buckets.map(() => 0) });
    }
    return series.get(unitId)!;
  };

  bucketRows.forEach((rows, index) => {
    rows.forEach((row) => {
      if (row.saleId ? !canSee(row.saleId) : !companyWide) return;
      const current = row.saleId ? unitIds.get(row.saleId) : null;
      const unitKey = tree.unitKeyOf({
        employeeId: row.saleId,
        departmentId: row.departmentId ?? (current ? String(current) : null)
      });
      tree.chainOf(unitKey).forEach((unitId) => {
        const entry = seriesOf(unitId);
        entry.values[index] += row.value;
        entry.bases[index] += row.base ?? 0;
      });
      totals.values[index] += row.value;
      totals.bases[index] += row.base ?? 0;
    });
  });

  const present = new Set(series.keys());
  const shape = (entry: { values: number[]; bases: number[] }) =>
    ratio
      ? {
          values: entry.values.map((v, i) => completionRatio(v, entry.bases[i])),
          numerators: entry.values,
          bases: entry.bases
        }
      : { values: entry.values };
  const def = METRICS[input.metric as MetricCode];

  return {
    metric: {
      code: def.code,
      name: def.name,
      unit: def.unit,
      source: def.source,
      aggregation: aggregationOf(input.metric as MetricCode)
    },
    granularity: input.granularity,
    to: input.toKey,
    company_wide: companyWide,
    buckets: buckets.map((b) => ({
      key: b.key,
      label: b.label,
      from: b.fromKey,
      to: b.toKey
    })),
    totals: shape(totals),
    units: [...present].map((unitId) => ({
      ...tree.describe(unitId, present),
      ...shape(series.get(unitId)!)
    }))
  };
}

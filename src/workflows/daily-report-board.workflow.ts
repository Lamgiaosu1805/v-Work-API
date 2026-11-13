import DepartmentModel from "../models/DepartmentModel";
import UserInfoModel from "../models/UserInfoModel";
import { resolveSaleUnitIds } from "../helpers/kpiAttribution";
import type { Ability } from "../modules/permission";
import { listFullLeaveDays } from "../modules/timesheet";
import {
  AUTO_METRIC_CODES,
  DEFAULT_TEMPLATE,
  aggregationOf,
  KPI_TEMPLATES,
  METRICS,
  METRIC_ORDER,
  REPORT_DEADLINES,
  addInto,
  completionRatio,
  deadlineOf,
  emptyPeriodValues,
  endOfMonthKey,
  isReportDay,
  listDailyReports,
  listKpiPlans,
  loadHolidayKeys,
  manualMetrics,
  monthOf,
  monthlyTarget,
  periodRanges,
  plannableMetrics,
  reportDaysBetween,
  requireAppId,
  saveDailyReportPlan,
  shortfall,
  submissionStatus,
  submitDailyReportResult,
  suggestedDailyTarget,
  templateMetrics,
  toDateKey,
  yearOf
} from "../modules/daily-report";
import type {
  DailyReportView,
  KpiPlanView,
  KpiTemplateCode,
  MetricCode,
  MetricDef,
  PeriodValues,
  SubmissionStatus
} from "../modules/daily-report";
import { AUTO_METRIC_SOURCES } from "./daily-report/auto-metric-sources";
import { loadUnitTree, viewerScope } from "./daily-report/unit-tree";

// Bảng báo cáo ngày + KPI theo cây đơn vị (docs/CRM-DAILY-REPORT-FLOWS.md mục 5–6):
// gộp số tự động (ghi nhận KPI), số Sale nhập tay, kế hoạch KPI năm, tình hình nộp báo cáo, tuân thủ.
// Số gom theo (Sale, TTKD lúc phát sinh); cộng dồn lên mọi cấp cha trong cây phòng ban.

export const DAILY_REPORT_DEFAULT_APP = "tikluy";

const PERIODS = ["day", "mtd", "ytd"] as const;
type Period = (typeof PERIODS)[number];

interface Cell {
  actual: PeriodValues;
  base: PeriodValues | null; // mẫu số của chỉ tiêu tỷ lệ (tuân thủ)
  planYear: number | null;
  planMonth: number | null;
  planDay: number | null;
}

interface BoardRow {
  employeeId: string | null;
  departmentId: string | null;
  cells: Map<MetricCode, Cell>;
}

interface Submission {
  required: boolean;
  plan: SubmissionStatus;
  result: SubmissionStatus;
}

interface Board {
  appId: string;
  dateKey: string;
  rows: Map<string, BoardRow>;
  plans: Map<string, KpiPlanView>;
  participants: Set<string>;
  reportsToday: Map<string, DailyReportView>;
  submissions: Map<string, Submission>;
  currentUnit: Map<string, string | null>;
  holidays: Set<string>;
}

const emptyCell = (): Cell => ({
  actual: emptyPeriodValues(),
  base: null,
  planYear: null,
  planMonth: null,
  planDay: null
});

const addNullable = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

function mergeCell(target: Cell, source: Cell): void {
  addInto(target.actual, source.actual);
  if (source.base) {
    // Chỉ tiêu tỷ lệ: cộng tử số + mẫu số; kế hoạch là 1 tỷ lệ (vd 70%) → giữ nguyên, không cộng
    target.base = addInto(target.base ?? emptyPeriodValues(), source.base);
    target.planYear = target.planYear ?? source.planYear;
    target.planMonth = target.planMonth ?? source.planMonth;
    return;
  }
  target.planYear = addNullable(target.planYear, source.planYear);
  target.planMonth = addNullable(target.planMonth, source.planMonth);
  target.planDay = addNullable(target.planDay, source.planDay);
}

function periodsOf(dayKey: string, dateKey: string): Period[] {
  const periods: Period[] = ["ytd"];
  if (dayKey.slice(0, 7) === dateKey.slice(0, 7)) periods.push("mtd");
  if (dayKey === dateKey) periods.push("day");
  return periods;
}

async function buildBoard(input: {
  appId: string;
  dateKey: string;
  now: Date;
  employeeIds: string[] | null; // null = mọi nhân viên
  includeUnassigned: boolean;
}): Promise<Board> {
  const { appId, dateKey, now, employeeIds } = input;
  const ranges = periodRanges(dateKey);
  const year = yearOf(dateKey);
  const month = monthOf(dateKey);
  const yearStart = `${year}-01-01`;

  const [planList, reports, holidays, autoResults] = await Promise.all([
    listKpiPlans(appId, year, employeeIds ?? undefined),
    listDailyReports(appId, yearStart, dateKey, employeeIds ?? undefined),
    loadHolidayKeys(yearStart, `${year}-12-31`),
    Promise.all(
      Object.keys(AUTO_METRIC_SOURCES).flatMap((metric) =>
        (
          [
            ["day", ranges.day],
            ["mtd", ranges.month],
            ["ytd", ranges.year]
          ] as const
        ).map(async ([period, range]) => ({
          metric,
          period,
          rows: await AUTO_METRIC_SOURCES[metric]({ appId, range, saleIds: employeeIds })
        }))
      )
    )
  ]);

  const plans = new Map(planList.map((plan) => [plan.employeeId, plan]));
  const participants = new Set(
    planList.filter((plan) => plan.effectiveFrom <= dateKey).map((plan) => plan.employeeId)
  );

  const employees = new Set<string>([...plans.keys(), ...reports.map((r) => r.employeeId)]);
  autoResults.forEach(({ rows }) =>
    rows.forEach((row) => {
      if (row.saleId) employees.add(row.saleId);
    })
  );
  const [unitIds, leaveDays] = await Promise.all([
    resolveSaleUnitIds([...employees]),
    listFullLeaveDays([...participants], ranges.year.from, ranges.year.to)
  ]);
  const currentUnit = new Map<string, string | null>(
    [...employees].map((id) => {
      const unit = unitIds.get(id);
      return [id, unit ? String(unit) : null];
    })
  );

  const rows = new Map<string, BoardRow>();
  const cellOf = (employeeId: string | null, departmentId: string | null, metric: MetricCode) => {
    const key = `${employeeId ?? "-"}|${departmentId ?? "-"}`;
    if (!rows.has(key)) rows.set(key, { employeeId, departmentId, cells: new Map() });
    const row = rows.get(key)!;
    if (!row.cells.has(metric)) row.cells.set(metric, emptyCell());
    return row.cells.get(metric)!;
  };

  // Số tự động — TTKD theo ghi nhận lúc phát sinh, nguồn không chụp TTKD thì lấy TTKD hiện tại
  autoResults.forEach(({ metric, period, rows: metricRows }) => {
    metricRows.forEach((row) => {
      if (!row.saleId && !input.includeUnassigned) return;
      const unit = row.departmentId ?? (row.saleId ? (currentUnit.get(row.saleId) ?? null) : null);
      const cell = cellOf(row.saleId, unit, metric as MetricCode);
      cell.actual[period] += row.value;
      if (row.base !== undefined) {
        cell.base = cell.base ?? emptyPeriodValues();
        cell.base[period] += row.base;
      }
    });
  });

  // Tăng net = tiền vào − tiền ra trên cùng (Sale, TTKD) → cộng dồn lên cây vẫn khớp từng cấp
  rows.forEach((row) => {
    const inflow = row.cells.get("investment_amount");
    const outflow = row.cells.get("investment_outflow");
    if (!inflow && !outflow) return;
    const net = emptyCell();
    PERIODS.forEach((period) => {
      net.actual[period] = (inflow?.actual[period] ?? 0) - (outflow?.actual[period] ?? 0);
    });
    row.cells.set("net_growth", net);
  });

  // Số nhập tay + mục tiêu ngày — TTKD theo phiếu báo cáo
  const reportsByEmployee = new Map<string, Map<string, DailyReportView>>();
  const reportsToday = new Map<string, DailyReportView>();
  reports.forEach((report) => {
    if (!reportsByEmployee.has(report.employeeId))
      reportsByEmployee.set(report.employeeId, new Map());
    reportsByEmployee.get(report.employeeId)!.set(report.reportDate, report);
    const unit = report.departmentId ?? currentUnit.get(report.employeeId) ?? null;
    const periods = periodsOf(report.reportDate, dateKey);
    report.result.values.forEach((value) => {
      if (!(value.metricCode in METRICS)) return;
      const cell = cellOf(report.employeeId, unit, value.metricCode as MetricCode);
      periods.forEach((period) => {
        cell.actual[period] += value.value;
      });
    });
    if (report.reportDate === dateKey) {
      reportsToday.set(report.employeeId, report);
      report.plan.targets.forEach((target) => {
        if (!(target.metricCode in METRICS)) return;
        const cell = cellOf(report.employeeId, unit, target.metricCode as MetricCode);
        cell.planDay = (cell.planDay ?? 0) + target.value;
      });
    }
  });

  // Kế hoạch năm/tháng — gắn vào TTKD hiện tại của Sale
  plans.forEach((plan) => {
    const unit = currentUnit.get(plan.employeeId) ?? null;
    plan.targets.forEach((target, metric) => {
      if (!(metric in METRICS)) return;
      const cell = cellOf(plan.employeeId, unit, metric as MetricCode);
      if (aggregationOf(metric as MetricCode) === "ratio") {
        // KH tỷ lệ (tái tục 70%, tuân thủ 100%) áp dụng nguyên cho mọi kỳ; nhập 70 hay 0.7 đều hiểu là 70%
        const rate = target.annual > 1 ? target.annual / 100 : target.annual;
        cell.planYear = rate;
        cell.planMonth = rate;
        return;
      }
      cell.planYear = (cell.planYear ?? 0) + target.annual;
      cell.planMonth = (cell.planMonth ?? 0) + monthlyTarget(target, month);
    });
  });

  // Tình hình nộp hôm nay + tuân thủ (chỉ người phải báo cáo)
  const resultDeadlineToday = deadlineOf(dateKey, "result");
  const submissions = new Map<string, Submission>();
  participants.forEach((employeeId) => {
    const plan = plans.get(employeeId)!;
    const leaves = leaveDays.get(employeeId) ?? new Set<string>();
    const ownReports = reportsByEmployee.get(employeeId) ?? new Map<string, DailyReportView>();
    const statusOf = (dayKey: string, required: boolean, nowAt: Date) => {
      const report = ownReports.get(dayKey);
      return {
        required,
        plan: submissionStatus({
          submittedAt: report?.plan.submittedAt ?? null,
          dateKey: dayKey,
          kind: "plan",
          now: nowAt,
          required
        }),
        result: submissionStatus({
          submittedAt: report?.result.submittedAt ?? null,
          dateKey: dayKey,
          kind: "result",
          now: nowAt,
          required
        })
      };
    };

    const requiredToday = isReportDay(dateKey, holidays) && !leaves.has(dateKey);
    submissions.set(employeeId, statusOf(dateKey, requiredToday, now));

    const from = plan.effectiveFrom > yearStart ? plan.effectiveFrom : yearStart;
    const cell = cellOf(employeeId, currentUnit.get(employeeId) ?? null, "compliance");
    cell.base = cell.base ?? emptyPeriodValues();
    reportDaysBetween(from, dateKey, holidays).forEach((dayKey) => {
      if (leaves.has(dayKey)) return;
      const status = statusOf(dayKey, true, now);
      const onTime = status.plan === "on_time" && status.result === "on_time";
      // Hôm nay chỉ tính khi đã qua giờ chốt hoặc đã nộp đủ đúng hạn
      const closed = dayKey < dateKey || now.getTime() > resultDeadlineToday.getTime();
      if (!closed && !onTime) return;
      periodsOf(dayKey, dateKey).forEach((period) => {
        cell.base![period] += 1;
        if (onTime) cell.actual[period] += 1;
      });
    });
  });

  return {
    appId,
    dateKey,
    rows,
    plans,
    participants,
    reportsToday,
    submissions,
    currentUnit,
    holidays
  };
}

// ─── Định dạng trả về ───────────────────────────────────────────────────────

const round = (value: number | null) => (value === null ? null : Math.round(value * 10000) / 10000);

function serializeCell(metric: MetricCode, cell: Cell) {
  if (cell.base || aggregationOf(metric) === "ratio") {
    // Tỷ lệ thực hiện = tử / mẫu; % HT = tỷ lệ / KH tỷ lệ (không giao KH → so với 100%).
    // Có KH mà chưa phát sinh mẫu số (chưa khoản nào đáo hạn) vẫn trả dạng tỷ lệ, tỷ lệ = null.
    const base = cell.base ?? emptyPeriodValues();
    const planRate = cell.planYear ?? 1;
    const rate = (period: Period) => completionRatio(cell.actual[period], base[period]);
    const pct = (period: Period) => {
      const value = rate(period);
      return value === null ? null : round(value / planRate);
    };
    return {
      day: cell.actual.day,
      mtd: cell.actual.mtd,
      ytd: cell.actual.ytd,
      base: { ...base },
      plan_rate: cell.planYear,
      rate_day: round(rate("day")),
      rate_month: round(rate("mtd")),
      rate_year: round(rate("ytd")),
      pct_day: pct("day"),
      pct_month: pct("mtd"),
      pct_year: pct("ytd")
    };
  }
  return {
    day: cell.actual.day,
    mtd: cell.actual.mtd,
    ytd: cell.actual.ytd,
    plan_day: cell.planDay,
    plan_month: round(cell.planMonth),
    plan_year: cell.planYear,
    pct_day: round(completionRatio(cell.actual.day, cell.planDay)),
    pct_month: round(completionRatio(cell.actual.mtd, cell.planMonth)),
    pct_year: round(completionRatio(cell.actual.ytd, cell.planYear)),
    remaining_year: round(shortfall(cell.actual.ytd, cell.planYear)),
    ...((METRICS[metric] as MetricDef).source === "unavailable" ? { unavailable: true } : {})
  };
}

const serializeCells = (cells: Map<MetricCode, Cell>) =>
  Object.fromEntries(
    [...cells.entries()].map(([metric, cell]) => [metric, serializeCell(metric, cell)])
  );

const metricDefs = (codes: MetricCode[]) =>
  METRIC_ORDER.filter((code) => codes.includes(code)).map((code) => ({
    code,
    name: METRICS[code].name,
    unit: METRICS[code].unit,
    source: METRICS[code].source,
    note: (METRICS[code] as { note?: string }).note ?? null
  }));

function calendarInfo(dateKey: string, holidays: Set<string>) {
  const year = yearOf(dateKey);
  const monthStart = `${dateKey.slice(0, 7)}-01`;
  return {
    is_report_day: isReportDay(dateKey, holidays),
    month: {
      passed: reportDaysBetween(monthStart, dateKey, holidays).length,
      total: reportDaysBetween(monthStart, endOfMonthKey(dateKey), holidays).length
    },
    year: {
      passed: reportDaysBetween(`${year}-01-01`, dateKey, holidays).length,
      total: reportDaysBetween(`${year}-01-01`, `${year}-12-31`, holidays).length
    }
  };
}

const reportPayload = (report: DailyReportView | undefined) =>
  report
    ? {
        plan: {
          targets: report.plan.targets.map((t) => ({
            metric_code: t.metricCode,
            value: t.value,
            note: t.note
          })),
          note: report.plan.note,
          submitted_at: report.plan.submittedAt,
          updated_at: report.plan.updatedAt
        },
        result: {
          values: report.result.values.map((v) => ({
            metric_code: v.metricCode,
            value: v.value,
            note: v.note
          })),
          achievements: report.result.achievements,
          blockers: report.result.blockers,
          proposals: report.result.proposals,
          submitted_at: report.result.submittedAt,
          updated_at: report.result.updatedAt
        }
      }
    : null;

// ─── Bảng tổng hợp cho quản lý / lãnh đạo ──────────────────────────────────

interface SubmissionCount {
  required: number;
  plan_submitted: number;
  plan_on_time: number;
  result_submitted: number;
  result_on_time: number;
  result_late: number;
  result_not_submitted: number;
}

const emptySubmissionCount = (): SubmissionCount => ({
  required: 0,
  plan_submitted: 0,
  plan_on_time: 0,
  result_submitted: 0,
  result_on_time: 0,
  result_late: 0,
  result_not_submitted: 0
});

function countSubmission(count: SubmissionCount, submission: Submission): void {
  if (!submission.required) return;
  count.required += 1;
  if (["on_time", "late"].includes(submission.plan)) count.plan_submitted += 1;
  if (submission.plan === "on_time") count.plan_on_time += 1;
  if (["on_time", "late"].includes(submission.result)) count.result_submitted += 1;
  if (submission.result === "on_time") count.result_on_time += 1;
  if (submission.result === "late") count.result_late += 1;
  if (["pending", "overdue", "missing"].includes(submission.result))
    count.result_not_submitted += 1;
}

export async function getDailyReportSummary(input: {
  ability: Ability;
  dateKey: string;
  now: Date;
  appCode?: string;
}) {
  const appCode = input.appCode || DAILY_REPORT_DEFAULT_APP;
  const appId = await requireAppId(appCode);
  const { companyWide, canSee } = viewerScope(input.ability);
  const board = await buildBoard({
    appId,
    dateKey: input.dateKey,
    now: input.now,
    employeeIds: null,
    includeUnassigned: companyWide
  });

  const visibleRows = [...board.rows.values()].filter((row) =>
    row.employeeId ? canSee(row.employeeId) : companyWide
  );

  const tree = await loadUnitTree();
  const { unitKeyOf, chainOf } = tree;

  const unitCells = new Map<string, Map<MetricCode, Cell>>();
  const unitSubmissions = new Map<string, SubmissionCount>();
  const unitEmployees = new Map<string, Set<string>>();
  const totals = new Map<MetricCode, Cell>();
  const totalSubmission = emptySubmissionCount();

  visibleRows.forEach((row) => {
    const chain = chainOf(unitKeyOf(row));
    row.cells.forEach((cell, metric) => {
      chain.forEach((unitId) => {
        if (!unitCells.has(unitId)) unitCells.set(unitId, new Map());
        const cells = unitCells.get(unitId)!;
        if (!cells.has(metric)) cells.set(metric, emptyCell());
        mergeCell(cells.get(metric)!, cell);
      });
      if (!totals.has(metric)) totals.set(metric, emptyCell());
      mergeCell(totals.get(metric)!, cell);
    });
    if (row.employeeId) {
      chain.forEach((unitId) => {
        if (!unitEmployees.has(unitId)) unitEmployees.set(unitId, new Set());
        unitEmployees.get(unitId)!.add(row.employeeId!);
      });
    }
  });

  board.submissions.forEach((submission, employeeId) => {
    if (!canSee(employeeId)) return;
    const unitKey = unitKeyOf({
      employeeId,
      departmentId: board.currentUnit.get(employeeId) ?? null
    });
    chainOf(unitKey).forEach((unitId) => {
      if (!unitSubmissions.has(unitId)) unitSubmissions.set(unitId, emptySubmissionCount());
      countSubmission(unitSubmissions.get(unitId)!, submission);
    });
    countSubmission(totalSubmission, submission);
  });

  const unitIds = new Set([...unitCells.keys(), ...unitSubmissions.keys()]);
  const units = [...unitIds].map((unitId) => ({
    ...tree.describe(unitId, unitIds),
    employee_count: unitEmployees.get(unitId)?.size ?? 0,
    submission: unitSubmissions.get(unitId) ?? emptySubmissionCount(),
    metrics: serializeCells(unitCells.get(unitId) ?? new Map())
  }));

  const employeeIds = [
    ...new Set(visibleRows.map((row) => row.employeeId).filter(Boolean) as string[])
  ];
  const staff = (await UserInfoModel.find({ _id: { $in: employeeIds } })
    .select("full_name ma_nv")
    .lean()) as any[];
  const staffById = new Map(staff.map((s) => [String(s._id), s]));

  const employees = visibleRows
    .filter((row) => row.employeeId)
    .map((row) => {
      const employeeId = row.employeeId!;
      const unitKey = unitKeyOf(row);
      const isCurrentUnit =
        unitKey ===
        unitKeyOf({ employeeId, departmentId: board.currentUnit.get(employeeId) ?? null });
      const submission = isCurrentUnit ? board.submissions.get(employeeId) : undefined;
      const plan = board.plans.get(employeeId);
      return {
        employee_id: employeeId,
        ma_nv: staffById.get(employeeId)?.ma_nv ?? null,
        full_name: staffById.get(employeeId)?.full_name ?? null,
        unit_id: unitKey,
        is_current_unit: isCurrentUnit,
        participant: board.participants.has(employeeId),
        template_code: plan?.templateCode ?? null,
        plan_status: submission?.plan ?? null,
        result_status: submission?.result ?? null,
        report: isCurrentUnit ? reportPayload(board.reportsToday.get(employeeId)) : null,
        metrics: serializeCells(row.cells)
      };
    });

  const templates = new Set<KpiTemplateCode>(
    [...board.participants].map((id) => board.plans.get(id)!.templateCode)
  );
  const metricCodes = new Set<MetricCode>([...AUTO_METRIC_CODES, "compliance"]);
  templates.forEach((code) => templateMetrics(code).forEach((metric) => metricCodes.add(metric)));

  return {
    date: input.dateKey,
    app_code: appCode,
    generated_at: input.now,
    company_wide: companyWide,
    deadlines: REPORT_DEADLINES,
    calendar: calendarInfo(input.dateKey, board.holidays),
    metrics: metricDefs([...metricCodes]),
    // Bộ KPI (trọng số) để web dựng mẫu 13 cột cho từng Sale theo template_code
    templates: KPI_TEMPLATES,
    totals: { submission: totalSubmission, metrics: serializeCells(totals) },
    units,
    employees
  };
}

// ─── Màn "Báo cáo ngày của tôi" ─────────────────────────────────────────────

export async function getMyDailyReport(input: {
  employeeId: string;
  dateKey: string;
  now: Date;
  appCode?: string;
}) {
  const appCode = input.appCode || DAILY_REPORT_DEFAULT_APP;
  const appId = await requireAppId(appCode);
  const board = await buildBoard({
    appId,
    dateKey: input.dateKey,
    now: input.now,
    employeeIds: [input.employeeId],
    includeUnassigned: false
  });

  const plan = board.plans.get(input.employeeId) ?? null;
  const templateCode = plan?.templateCode ?? DEFAULT_TEMPLATE;
  const merged = new Map<MetricCode, Cell>();
  board.rows.forEach((row) => {
    if (row.employeeId !== input.employeeId) return;
    row.cells.forEach((cell, metric) => {
      if (!merged.has(metric)) merged.set(metric, emptyCell());
      mergeCell(merged.get(metric)!, cell);
    });
  });

  const reportDaysLeft = reportDaysBetween(
    input.dateKey,
    endOfMonthKey(input.dateKey),
    board.holidays
  ).length;
  const weights = new Map(KPI_TEMPLATES[templateCode].items.map((i) => [i.metric, i.weight]));
  const metrics = metricDefs(templateMetrics(templateCode)).map((def) => {
    const cell = merged.get(def.code) ?? emptyCell();
    const target = plan?.targets.get(def.code);
    const monthTarget = target ? monthlyTarget(target, monthOf(input.dateKey)) : null;
    return {
      ...def,
      weight: weights.get(def.code) ?? null,
      ...serializeCell(def.code, cell),
      suggested_day:
        cell.base ||
        (def as MetricDef).source === "unavailable" ||
        aggregationOf(def.code) !== "sum"
          ? null
          : round(
              suggestedDailyTarget({
                monthTarget,
                doneBeforeToday: cell.actual.mtd - cell.actual.day,
                reportDaysLeft
              })
            )
    };
  });

  const report = board.reportsToday.get(input.employeeId);
  const submission = board.submissions.get(input.employeeId);
  const isToday = input.dateKey === toDateKey(input.now);
  const resultDeadline = deadlineOf(input.dateKey, "result");
  const beforeCutoff = input.now.getTime() <= resultDeadline.getTime();
  const unitId = board.currentUnit.get(input.employeeId) ?? null;
  const unit = unitId
    ? ((await DepartmentModel.findById(unitId).select("department_name").lean()) as any)
    : null;

  return {
    date: input.dateKey,
    app_code: appCode,
    is_today: isToday,
    participant: board.participants.has(input.employeeId),
    template: { code: templateCode, name: KPI_TEMPLATES[templateCode].name },
    decision_ref: plan?.decisionRef ?? null,
    unit: unit ? { id: unitId, name: unit.department_name } : null,
    deadlines: {
      plan: deadlineOf(input.dateKey, "plan"),
      result: resultDeadline
    },
    calendar: calendarInfo(input.dateKey, board.holidays),
    required: submission?.required ?? false,
    plan_status: submission?.plan ?? null,
    result_status: submission?.result ?? null,
    can_edit_plan: isToday && beforeCutoff,
    can_submit_result: isToday && (!report?.result.submittedAt || beforeCutoff),
    plannable_metrics: plannableMetrics(templateCode),
    manual_metrics: manualMetrics(templateCode),
    metrics,
    report: reportPayload(report)
  };
}

// ─── Nộp kế hoạch / kết quả ─────────────────────────────────────────────────

async function writeContext(employeeId: string, now: Date, appCode?: string) {
  const appId = await requireAppId(appCode || DAILY_REPORT_DEFAULT_APP);
  const dateKey = toDateKey(now);
  const [plans, units] = await Promise.all([
    listKpiPlans(appId, yearOf(dateKey), [employeeId]),
    resolveSaleUnitIds([employeeId])
  ]);
  const unit = units.get(employeeId);
  return {
    appId,
    employeeId,
    departmentId: unit ? String(unit) : null,
    templateCode: plans[0]?.templateCode ?? DEFAULT_TEMPLATE,
    now
  };
}

export async function saveMyDailyReportPlan(input: {
  employeeId: string;
  now: Date;
  appCode?: string;
  body: { targets: unknown; note: unknown };
}) {
  await saveDailyReportPlan(
    await writeContext(input.employeeId, input.now, input.appCode),
    input.body
  );
  return getMyDailyReport({ ...input, dateKey: toDateKey(input.now) });
}

export async function submitMyDailyReportResult(input: {
  employeeId: string;
  now: Date;
  appCode?: string;
  body: { values: unknown; achievements: unknown; blockers: unknown; proposals: unknown };
}) {
  await submitDailyReportResult(
    await writeContext(input.employeeId, input.now, input.appCode),
    input.body
  );
  return getMyDailyReport({ ...input, dateKey: toDateKey(input.now) });
}

// ─── Nhắc nộp (cron) ────────────────────────────────────────────────────────

/** Account cần nhắc nộp kế hoạch/kết quả hôm nay: có kế hoạch KPI, hôm nay phải báo cáo, chưa nộp phần đó. */
export async function listDailyReportReminderAccounts(input: {
  kind: "plan" | "result";
  now: Date;
  appCode?: string;
}): Promise<string[]> {
  const appId = await requireAppId(input.appCode || DAILY_REPORT_DEFAULT_APP);
  const dateKey = toDateKey(input.now);
  const holidays = await loadHolidayKeys(dateKey, dateKey);
  if (!isReportDay(dateKey, holidays)) return [];

  const plans = (await listKpiPlans(appId, yearOf(dateKey))).filter(
    (plan) => plan.effectiveFrom <= dateKey
  );
  const employeeIds = plans.map((plan) => plan.employeeId);
  if (!employeeIds.length) return [];

  const { day } = periodRanges(dateKey);
  const [reports, leaveDays] = await Promise.all([
    listDailyReports(appId, dateKey, dateKey, employeeIds),
    listFullLeaveDays(employeeIds, day.from, day.to)
  ]);
  const submitted = new Set(
    reports
      .filter((r) => (input.kind === "plan" ? r.plan.submittedAt : r.result.submittedAt))
      .map((r) => r.employeeId)
  );
  const pending = employeeIds.filter(
    (id) => !submitted.has(id) && !leaveDays.get(id)?.has(dateKey)
  );
  if (!pending.length) return [];

  const staff = (await UserInfoModel.find({ _id: { $in: pending }, isDeleted: false })
    .select("id_account")
    .lean()) as any[];
  return staff.map((s) => String(s.id_account)).filter(Boolean);
}

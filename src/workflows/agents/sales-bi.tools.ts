import moment from "moment-timezone";
import { loadRules } from "../../core/authorization/require-permission.middleware";
import { buildAbility } from "../../modules/permission";
import type { Ability } from "../../modules/permission";
import type { AgentRunContext, AgentToolSpec } from "../../modules/agent-harness";
import { getDailyReportSummary } from "../daily-report-board.workflow";
import { getDailyReportTrend } from "../daily-report-trend.workflow";

// Công cụ CHỈ ĐỌC của agent "Trợ lý kinh doanh" (sales-bi) — gọi đúng các hàm của Bảng điều hành / Tổng hợp báo cáo
// ngày, áp phạm vi `daily_report.view` của CHÍNH người hỏi. Không trả SĐT / CCCD / thông tin khách hàng.
// Tiền trả về theo TRIỆU ĐỒNG (1 số lẻ), tỷ lệ theo %.

const TZ = "Asia/Ho_Chi_Minh";
const APP_CODE = "tikluy";
const PERIODS = ["day", "mtd", "ytd"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABEL: Record<Period, string> = {
  day: "trong ngày",
  mtd: "lũy kế tháng",
  ytd: "lũy kế năm"
};

export const SALES_BI_METRICS = [
  "investment_amount",
  "investment_outflow",
  "net_growth",
  "aum",
  "renewal_rate",
  "cif_new",
  "cif_first_investment",
  "telesale_call",
  "consult_meeting",
  "merchant_sale",
  "ctv_new",
  "merchant_active",
  "roadshow"
] as const;
const OVERVIEW_METRICS = SALES_BI_METRICS.slice(0, 8);
const RATE_KEY: Record<Period, string> = { day: "rate_day", mtd: "rate_month", ytd: "rate_year" };
const PLAN_KEY: Record<Period, string> = { day: "plan_day", mtd: "plan_month", ytd: "plan_year" };
const PCT_KEY: Record<Period, string> = { day: "pct_day", mtd: "pct_month", ytd: "pct_year" };

// ---------- tiện ích ----------

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const round1 = (v: number) => Math.round(v * 10) / 10;

function todayKey(now: Date) {
  return moment.tz(now, TZ).format("YYYY-MM-DD");
}

function dateKeyOf(input: unknown, now: Date): string {
  if (input === null || input === undefined || input === "") return todayKey(now);
  const parsed = moment.tz(String(input), "YYYY-MM-DD", true, TZ);
  if (!parsed.isValid()) throw new Error(`Ngày "${input}" không hợp lệ (cần YYYY-MM-DD)`);
  const key = parsed.format("YYYY-MM-DD");
  if (key > todayKey(now)) throw new Error("Không có số liệu cho ngày trong tương lai");
  return key;
}

const periodOf = (input: unknown): Period =>
  PERIODS.includes(input as Period) ? (input as Period) : "mtd";

function metricOf(input: unknown): string {
  if (!SALES_BI_METRICS.includes(input as (typeof SALES_BI_METRICS)[number])) {
    throw new Error(
      `Chỉ tiêu "${input}" không hỗ trợ. Dùng một trong: ${SALES_BI_METRICS.join(", ")}`
    );
  }
  return String(input);
}

async function abilityOf(employeeId: string): Promise<Ability> {
  return buildAbility(await loadRules(employeeId));
}

// Kết quả bảng tổng hợp dùng lại trong 1 phút cho cùng người hỏi + ngày (1 câu hỏi thường gọi nhiều công cụ)
const summaryCache = new Map<string, { at: number; value: Promise<any> }>();
const SUMMARY_TTL_MS = 60_000;

async function summaryFor(ctx: AgentRunContext, dateKey: string): Promise<any> {
  const key = `${ctx.employeeId}|${dateKey}`;
  const hit = summaryCache.get(key);
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return hit.value;
  const value = (async () =>
    getDailyReportSummary({
      ability: await abilityOf(ctx.employeeId),
      dateKey,
      now: ctx.now,
      appCode: APP_CODE
    }))();
  summaryCache.set(key, { at: Date.now(), value });
  value.catch(() => summaryCache.delete(key));
  if (summaryCache.size > 200) summaryCache.delete(summaryCache.keys().next().value as string);
  return value;
}

/** Giá trị 1 ô chỉ tiêu theo kỳ: tiền → triệu, tỷ lệ → %, còn lại giữ nguyên. */
function cellValue(def: any, cell: any, period: Period) {
  if (!def) return null;
  const ratio = def.aggregation === "ratio";
  if (ratio) {
    const rate = cell?.[RATE_KEY[period]];
    const plan = cell?.plan_rate;
    return {
      value: rate === null || rate === undefined ? null : round1(rate * 100),
      plan: plan === null || plan === undefined ? null : round1(plan * 100),
      pct_of_plan:
        plan && cell?.[PCT_KEY[period]] != null ? round1(cell[PCT_KEY[period]] * 100) : null,
      value_unit: "%"
    };
  }
  const money = def.unit === "VND";
  const scale = (v: unknown) => {
    if (v === null || v === undefined) return null;
    return round1(money ? Number(v) / 1_000_000 : Number(v));
  };
  const pct = cell?.[PCT_KEY[period]];
  return {
    value: scale(cell?.[period] ?? 0),
    plan: scale(cell?.[PLAN_KEY[period]]),
    pct_of_plan: pct === null || pct === undefined ? null : round1(pct * 100),
    value_unit: money ? "triệu đồng" : def.unit
  };
}

const defsOf = (summary: any) => new Map<string, any>(summary.metrics.map((m: any) => [m.code, m]));

function unitPath(summary: any, unitId: string): string {
  const byId = new Map<string, any>(summary.units.map((u: any) => [u.id, u]));
  const names: string[] = [];
  let cur = byId.get(unitId);
  while (cur) {
    names.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return names.join(" › ");
}

function findUnits(summary: any, query: string): any[] {
  const q = norm(query);
  const exact = summary.units.filter((u: any) => norm(u.name) === q || norm(u.code) === q);
  if (exact.length) return exact;
  return summary.units.filter((u: any) => norm(u.name).includes(q) || norm(u.code).includes(q));
}

function subtreeIds(summary: any, unitId: string): Set<string> {
  const ids = new Set([unitId]);
  const queue = [unitId];
  while (queue.length) {
    const parent = queue.shift();
    summary.units
      .filter((u: any) => u.parent_id === parent && !ids.has(u.id))
      .forEach((u: any) => {
        ids.add(u.id);
        queue.push(u.id);
      });
  }
  return ids;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const DATE_PARAM = nullable({
  type: "string",
  format: "date",
  description: "Ngày xem số liệu YYYY-MM-DD; null = hôm nay"
});
const PERIOD_PARAM = {
  type: "string",
  enum: [...PERIODS],
  description: "day = trong ngày, mtd = lũy kế từ đầu tháng tới ngày xem, ytd = lũy kế từ đầu năm"
};
const METRIC_PARAM = { type: "string", enum: [...SALES_BI_METRICS], description: "Mã chỉ tiêu" };

// ---------- công cụ ----------

const getOverview: AgentToolSpec = {
  name: "get_overview",
  description:
    "Tổng quan kinh doanh trong phạm vi người hỏi được xem: tiền vào, tiền ra, tăng net, số dư đang đầu tư, tỷ lệ tái tục, CIF, cuộc gọi… theo kỳ; kèm kế hoạch và % hoàn thành nếu đã giao; tình hình nộp báo cáo ngày; tiến độ thời gian. Dùng cho câu hỏi chung về toàn công ty / phạm vi của người hỏi.",
  inputSchema: {
    type: "object",
    properties: { date: DATE_PARAM, period: PERIOD_PARAM },
    required: ["date", "period"],
    additionalProperties: false
  },
  async run(input, ctx) {
    const dateKey = dateKeyOf(input.date, ctx.now);
    const period = periodOf(input.period);
    const summary = await summaryFor(ctx, dateKey);
    const defs = defsOf(summary);
    const metrics = Object.fromEntries(
      OVERVIEW_METRICS.filter((code) => defs.has(code)).map((code) => [
        code,
        {
          name: defs.get(code).name,
          ...cellValue(defs.get(code), summary.totals.metrics[code], period)
        }
      ])
    );
    return {
      as_of: dateKey,
      period: PERIOD_LABEL[period],
      company_wide: summary.company_wide,
      metrics,
      aum_note: "Số dư đang đầu tư là ảnh chụp cuối ngày xem, không phụ thuộc kỳ",
      submission_today: summary.totals.submission,
      time_progress: summary.calendar
    };
  }
};

const compareUnits: AgentToolSpec = {
  name: "compare_units",
  description:
    "So sánh / xếp hạng các đơn vị theo 1 chỉ tiêu và kỳ. parent = null → so tất cả TTKD (trung tâm kinh doanh); parent = tên một khối/chi nhánh → so các đơn vị trực thuộc. Trả về giá trị, kế hoạch, % hoàn thành, số Sale, bình quân mỗi Sale, cùng các dòng ngoài xếp hạng (Chưa phân bổ, Chưa gán TTKD).",
  inputSchema: {
    type: "object",
    properties: {
      date: DATE_PARAM,
      period: PERIOD_PARAM,
      metric: METRIC_PARAM,
      parent: nullable({
        type: "string",
        description: "Tên khối / chi nhánh cha; null = tất cả TTKD"
      })
    },
    required: ["date", "period", "metric", "parent"],
    additionalProperties: false
  },
  async run(input, ctx) {
    const dateKey = dateKeyOf(input.date, ctx.now);
    const period = periodOf(input.period);
    const metric = metricOf(input.metric);
    const summary = await summaryFor(ctx, dateKey);
    const def = defsOf(summary).get(metric);
    if (!def) throw new Error(`Chưa có số liệu chỉ tiêu ${metric}`);
    let units: any[];
    let scope: string;
    if (input.parent) {
      const parents = findUnits(summary, String(input.parent));
      if (!parents.length)
        throw new Error(`Không tìm thấy đơn vị "${input.parent}" trong phạm vi xem`);
      const parent = parents[0];
      units = summary.units.filter((u: any) => u.parent_id === parent.id);
      scope = `trực thuộc ${parent.name}`;
    } else {
      units = summary.units.filter((u: any) => u.type === "branch");
      scope = "tất cả TTKD";
    }
    const rows = units
      .map((u: any) => {
        const v = cellValue(def, u.metrics?.[metric], period)!;
        const perSale =
          def.aggregation !== "ratio" && u.employee_count && v.value !== null
            ? round1(v.value / u.employee_count)
            : null;
        return {
          unit: u.name,
          path: unitPath(summary, u.id),
          ...v,
          sale_count: u.employee_count,
          per_sale: perSale
        };
      })
      .sort((a: any, b: any) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
      .map((row: any, i: number) => ({ rank: i + 1, ...row }));
    const outside = summary.units
      .filter((u: any) => u.kind !== "department")
      .map((u: any) => ({ unit: u.name, ...cellValue(def, u.metrics?.[metric], period) }));
    return {
      as_of: dateKey,
      period: PERIOD_LABEL[period],
      metric: def.name,
      scope,
      rows,
      outside_ranking: outside
    };
  }
};

const getTrend: AgentToolSpec = {
  name: "get_trend",
  description:
    "Xu hướng 1 chỉ tiêu theo tuần báo cáo (thứ Sáu tuần trước → thứ Năm tuần này) hoặc tháng, kỳ cuối tính tới ngày xem. units = danh sách tên đơn vị cần xem (null = tổng phạm vi người hỏi).",
  inputSchema: {
    type: "object",
    properties: {
      metric: METRIC_PARAM,
      granularity: { type: "string", enum: ["week", "month"] },
      periods: nullable({ type: "integer", description: "Số kỳ (2–24); null = 8 tuần / 6 tháng" }),
      to: DATE_PARAM,
      units: nullable({ type: "array", items: { type: "string" } })
    },
    required: ["metric", "granularity", "periods", "to", "units"],
    additionalProperties: false
  },
  async run(input, ctx) {
    const metric = metricOf(input.metric);
    const toKey = dateKeyOf(input.to, ctx.now);
    const periods = input.periods
      ? Math.min(24, Math.max(2, Math.floor(Number(input.periods))))
      : undefined;
    const trend = await getDailyReportTrend({
      ability: await abilityOf(ctx.employeeId),
      metric,
      granularity: input.granularity === "month" ? "month" : "week",
      toKey,
      periods,
      appCode: APP_CODE
    });
    const ratio = trend.metric.aggregation === "ratio";
    const money = trend.metric.unit === "VND";
    const factor = ratio ? 100 : 1 / (money ? 1_000_000 : 1);
    const scale = (v: number | null) => (v === null || v === undefined ? null : round1(v * factor));
    let valueUnit = trend.metric.unit;
    if (ratio) valueUnit = "%";
    else if (money) valueUnit = "triệu đồng";
    const wanted = Array.isArray(input.units) ? (input.units as string[]).map(norm) : null;
    const series = wanted
      ? trend.units
          .filter((u: any) => wanted.some((w) => norm(u.name).includes(w) || norm(u.code) === w))
          .map((u: any) => ({ unit: u.name, values: u.values.map(scale) }))
      : [{ unit: "Tổng phạm vi xem", values: (trend.totals.values as number[]).map(scale) }];
    if (wanted && !series.length)
      throw new Error("Không tìm thấy đơn vị nào khớp trong phạm vi xem");
    return {
      metric: trend.metric.name,
      value_unit: valueUnit,
      buckets: trend.buckets.map((b: any) => b.label),
      series
    };
  }
};

const getPeople: AgentToolSpec = {
  name: "get_people",
  description:
    "Danh sách Sale (họ tên, mã NV, đơn vị) với số liệu theo 1 chỉ tiêu + kỳ, kèm trạng thái nộp kế hoạch / kết quả hôm đó. Lọc theo đơn vị (gồm cả đơn vị con) và/hoặc tên người; sắp giảm dần theo chỉ tiêu (order = asc để xem thấp nhất).",
  inputSchema: {
    type: "object",
    properties: {
      date: DATE_PARAM,
      period: PERIOD_PARAM,
      metric: METRIC_PARAM,
      unit: nullable({ type: "string" }),
      name: nullable({ type: "string", description: "Tìm theo họ tên hoặc mã NV" }),
      order: { type: "string", enum: ["desc", "asc"] },
      limit: nullable({ type: "integer", description: "Tối đa bao nhiêu người (≤ 50); null = 20" })
    },
    required: ["date", "period", "metric", "unit", "name", "order", "limit"],
    additionalProperties: false
  },
  async run(input, ctx) {
    const dateKey = dateKeyOf(input.date, ctx.now);
    const period = periodOf(input.period);
    const metric = metricOf(input.metric);
    const summary = await summaryFor(ctx, dateKey);
    const def = defsOf(summary).get(metric);
    if (!def) throw new Error(`Chưa có số liệu chỉ tiêu ${metric}`);
    let allowedUnits: Set<string> | null = null;
    if (input.unit) {
      const units = findUnits(summary, String(input.unit));
      if (!units.length) throw new Error(`Không tìm thấy đơn vị "${input.unit}" trong phạm vi xem`);
      allowedUnits = new Set(units.flatMap((u: any) => [...subtreeIds(summary, u.id)]));
    }
    const nameQ = input.name ? norm(input.name) : null;
    const unitName = new Map<string, string>(summary.units.map((u: any) => [u.id, u.name]));
    const limit = input.limit ? Math.min(50, Math.max(1, Math.floor(Number(input.limit)))) : 20;
    const rows = summary.employees
      .filter((e: any) => !allowedUnits || allowedUnits.has(e.unit_id))
      .filter((e: any) => !nameQ || norm(e.full_name).includes(nameQ) || norm(e.ma_nv) === nameQ)
      .map((e: any) => ({
        name: e.full_name,
        ma_nv: e.ma_nv,
        unit: unitName.get(e.unit_id) ?? null,
        ...cellValue(def, e.metrics?.[metric], period),
        has_kpi_plan: e.participant,
        plan_status: e.plan_status,
        result_status: e.result_status
      }))
      .sort((a: any, b: any) =>
        input.order === "asc"
          ? (a.value ?? Infinity) - (b.value ?? Infinity)
          : (b.value ?? -Infinity) - (a.value ?? -Infinity)
      );
    return {
      as_of: dateKey,
      period: PERIOD_LABEL[period],
      metric: def.name,
      total_matched: rows.length,
      rows: rows.slice(0, limit),
      status_legend:
        "on_time đúng hạn, late nộp trễ, overdue quá hạn chưa nộp, pending chưa tới hạn, missing không nộp, not_required không phải nộp"
    };
  }
};

const getSubmissionStatus: AgentToolSpec = {
  name: "get_submission_status",
  description:
    "Tình hình nộp báo cáo ngày (kế hoạch buổi sáng, kết quả cuối ngày) theo từng đơn vị và danh sách người chưa nộp / nộp trễ trong ngày xem. Chỉ tính Sale đã được giao kế hoạch KPI.",
  inputSchema: {
    type: "object",
    properties: { date: DATE_PARAM },
    required: ["date"],
    additionalProperties: false
  },
  async run(input, ctx) {
    const dateKey = dateKeyOf(input.date, ctx.now);
    const summary = await summaryFor(ctx, dateKey);
    const unitName = new Map<string, string>(summary.units.map((u: any) => [u.id, u.name]));
    const required = summary.employees.filter((e: any) => e.is_current_unit && e.participant);
    const pick = (fn: (e: any) => boolean) =>
      required
        .filter(fn)
        .map((e: any) => ({ name: e.full_name, unit: unitName.get(e.unit_id) ?? null }));
    return {
      as_of: dateKey,
      deadlines: summary.deadlines,
      is_report_day: summary.calendar?.is_report_day,
      totals: summary.totals.submission,
      by_unit: summary.units
        .filter((u: any) => u.submission?.required)
        .map((u: any) => ({ unit: u.name, ...u.submission })),
      plan_not_submitted: pick((e) => ["overdue", "missing", "pending"].includes(e.plan_status)),
      result_not_submitted: pick((e) => ["overdue", "missing"].includes(e.result_status)),
      result_late: pick((e) => e.result_status === "late"),
      note: required.length
        ? null
        : "Chưa Sale nào được giao kế hoạch KPI nên chưa ai phải nộp báo cáo ngày"
    };
  }
};

const getReportNotes: AgentToolSpec = {
  name: "get_report_notes",
  description:
    "Nội dung Sale tự ghi trong báo cáo ngày: ghi chú kế hoạch, kết quả nổi bật, khó khăn vướng mắc, đề xuất kiến nghị. Lọc theo đơn vị (gồm đơn vị con). Dùng khi hỏi lý do, khó khăn, kiến nghị.",
  inputSchema: {
    type: "object",
    properties: { date: DATE_PARAM, unit: nullable({ type: "string" }) },
    required: ["date", "unit"],
    additionalProperties: false
  },
  async run(input, ctx) {
    const dateKey = dateKeyOf(input.date, ctx.now);
    const summary = await summaryFor(ctx, dateKey);
    let allowed: Set<string> | null = null;
    if (input.unit) {
      const units = findUnits(summary, String(input.unit));
      if (!units.length) throw new Error(`Không tìm thấy đơn vị "${input.unit}" trong phạm vi xem`);
      allowed = new Set(units.flatMap((u: any) => [...subtreeIds(summary, u.id)]));
    }
    const unitName = new Map<string, string>(summary.units.map((u: any) => [u.id, u.name]));
    const notes = summary.employees
      .filter((e: any) => e.report && (!allowed || allowed.has(e.unit_id)))
      .map((e: any) => ({
        name: e.full_name,
        unit: unitName.get(e.unit_id) ?? null,
        plan_note: e.report.plan?.note ?? null,
        achievements: e.report.result?.achievements ?? null,
        blockers: e.report.result?.blockers ?? null,
        proposals: e.report.result?.proposals ?? null
      }))
      .filter((n: any) => n.plan_note || n.achievements || n.blockers || n.proposals);
    return { as_of: dateKey, count: notes.length, notes };
  }
};

export const SALES_BI_TOOLS: AgentToolSpec[] = [
  getOverview,
  compareUnits,
  getTrend,
  getPeople,
  getSubmissionStatus,
  getReportNotes
];

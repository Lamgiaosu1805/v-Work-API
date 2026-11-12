// Danh mục chỉ tiêu báo cáo ngày TIKLUY + bộ KPI theo nhóm (file "Khung KPI - TTKD và Priority").
// Xem docs/CRM-DAILY-SALES-REPORT-PLAN.md mục 2 và docs/CRM-DAILY-REPORT-FLOWS.md mục 4.

// auto: hệ thống tự tính từ ghi nhận KPI; manual: Sale nhập; derived: tính từ dữ liệu báo cáo ngày;
// unavailable: chưa có dữ liệu nguồn (hiển thị "chưa có dữ liệu").
export type MetricSource = "auto" | "manual" | "derived" | "unavailable";

export interface MetricDef {
  code: string;
  name: string;
  unit: string;
  source: MetricSource;
  note?: string;
}

export const METRICS = {
  investment_amount: {
    code: "investment_amount",
    name: "Đầu tư",
    unit: "VND",
    source: "auto",
    note: "Tiền vào (gross) các khoản đầu tư mới, trừ khoản bị huỷ"
  },
  cif_new: {
    code: "cif_new",
    name: "CIF",
    unit: "KH",
    source: "auto",
    note: "Khách Sale tự mang về, tính theo ngày được ghi nhận"
  },
  cif_first_investment: {
    code: "cif_first_investment",
    name: "CIF KH mới có giao dịch",
    unit: "KH",
    source: "auto",
    note: "Khách có khoản đầu tư đầu tiên trong kỳ"
  },
  telesale_call: {
    code: "telesale_call",
    name: "Telesale",
    unit: "cuộc gọi",
    source: "auto",
    note: "Cuộc gọi ra qua tổng đài OMICall, khách nghe máy từ 20 giây"
  },
  consult_meeting: {
    code: "consult_meeting",
    name: "Cuộc hẹn tư vấn khách hàng",
    unit: "cuộc hẹn",
    source: "manual"
  },
  merchant_sale: {
    code: "merchant_sale",
    name: "Merchant sale",
    unit: "merchant",
    source: "manual"
  },
  merchant_active: {
    code: "merchant_active",
    name: "Merchant Active",
    unit: "merchant",
    source: "manual"
  },
  ctv_new: { code: "ctv_new", name: "Cộng tác viên", unit: "CTV", source: "manual" },
  roadshow: { code: "roadshow", name: "Roadshow", unit: "buổi", source: "manual" },
  other_task: { code: "other_task", name: "Other (khác)", unit: "việc", source: "manual" },
  renewal_rate: {
    code: "renewal_rate",
    name: "Tỷ lệ tái tục đầu tư",
    unit: "%",
    source: "unavailable",
    note: "Chờ TIKLUY gửi sự kiện đáo hạn/tái tục"
  },
  compliance: {
    code: "compliance",
    name: "Tính tuân thủ (nộp báo cáo đúng hạn)",
    unit: "%",
    source: "derived",
    note: "Số ngày nộp kế hoạch và kết quả đúng hạn / số ngày phải báo cáo"
  }
} satisfies Record<string, MetricDef>;

export type MetricCode = keyof typeof METRICS;

export const METRIC_ORDER: MetricCode[] = [
  "investment_amount",
  "cif_new",
  "cif_first_investment",
  "telesale_call",
  "consult_meeting",
  "merchant_sale",
  "merchant_active",
  "ctv_new",
  "roadshow",
  "other_task",
  "renewal_rate",
  "compliance"
];

export const AUTO_METRIC_CODES = METRIC_ORDER.filter((code) => METRICS[code].source === "auto");

export type KpiTemplateCode = "TTKD" | "PRIORITY";

export interface KpiTemplateItem {
  metric: MetricCode;
  weight: number | null; // null = chỉ theo dõi, không tính điểm
}

export const KPI_TEMPLATES: Record<KpiTemplateCode, { name: string; items: KpiTemplateItem[] }> = {
  TTKD: {
    name: "KPI Trung tâm kinh doanh",
    // "Gọi vốn" (25%) là chỉ tiêu VNFITE — chưa áp dụng cho TIKLUY
    items: [
      { metric: "investment_amount", weight: 0.25 },
      { metric: "cif_new", weight: 0.1 },
      { metric: "merchant_sale", weight: 0.1 },
      { metric: "ctv_new", weight: 0.1 },
      { metric: "merchant_active", weight: null },
      { metric: "consult_meeting", weight: 0.1 },
      { metric: "telesale_call", weight: null },
      { metric: "roadshow", weight: null },
      { metric: "compliance", weight: 0.1 },
      { metric: "other_task", weight: null }
    ]
  },
  PRIORITY: {
    name: "KPI Priority",
    items: [
      { metric: "investment_amount", weight: 0.5 },
      { metric: "cif_first_investment", weight: 0.2 },
      { metric: "renewal_rate", weight: 0.2 },
      { metric: "compliance", weight: 0.1 }
    ]
  }
};

export const DEFAULT_TEMPLATE: KpiTemplateCode = "TTKD";

export function isKpiTemplateCode(value: unknown): value is KpiTemplateCode {
  return typeof value === "string" && value in KPI_TEMPLATES;
}

export function isMetricCode(value: unknown): value is MetricCode {
  return typeof value === "string" && value in METRICS;
}

export function templateMetrics(code: KpiTemplateCode): MetricCode[] {
  return KPI_TEMPLATES[code].items.map((item) => item.metric);
}

/** Chỉ tiêu Sale tự nhập kết quả trong báo cáo ngày. */
export function manualMetrics(code: KpiTemplateCode): MetricCode[] {
  return templateMetrics(code).filter((metric) => METRICS[metric].source === "manual");
}

/** Chỉ tiêu Sale đặt mục tiêu trong kế hoạch ngày (có số đếm được: tự động + nhập tay). */
export function plannableMetrics(code: KpiTemplateCode): MetricCode[] {
  return templateMetrics(code).filter((metric) =>
    ["auto", "manual"].includes(METRICS[metric].source)
  );
}

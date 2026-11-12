// Use-case ĐỌC (CQRS-lite): query thẳng Mongoose, không dựng Entity.
import DailyReportModel from "../../../models/DailyReportModel";
import KpiPlanModel from "../../../models/KpiPlanModel";
import { MetricTarget } from "../domain/kpi-progress";
import { DEFAULT_TEMPLATE, KpiTemplateCode, isKpiTemplateCode } from "../domain/kpi-metrics";

export interface KpiPlanView {
  employeeId: string;
  year: number;
  templateCode: KpiTemplateCode;
  effectiveFrom: string;
  decisionRef: string | null;
  targets: Map<string, MetricTarget>;
}

export interface MetricValueView {
  metricCode: string;
  value: number;
  note: string | null;
}

export interface DailyReportView {
  id: string;
  employeeId: string;
  departmentId: string | null;
  reportDate: string;
  plan: {
    targets: MetricValueView[];
    note: string | null;
    submittedAt: Date | null;
    updatedAt: Date | null;
  };
  result: {
    values: MetricValueView[];
    achievements: string | null;
    blockers: string | null;
    proposals: string | null;
    submittedAt: Date | null;
    updatedAt: Date | null;
  };
}

const valueView = (item: any): MetricValueView => ({
  metricCode: item.metric_code,
  value: item.value,
  note: item.note ?? null
});

export function toDailyReportView(doc: any): DailyReportView {
  return {
    id: String(doc._id),
    employeeId: String(doc.employee_id),
    departmentId: doc.department_id ? String(doc.department_id) : null,
    reportDate: doc.report_date,
    plan: {
      targets: (doc.plan?.targets ?? []).map(valueView),
      note: doc.plan?.note ?? null,
      submittedAt: doc.plan?.submitted_at ?? null,
      updatedAt: doc.plan?.updated_at ?? null
    },
    result: {
      values: (doc.result?.values ?? []).map(valueView),
      achievements: doc.result?.achievements ?? null,
      blockers: doc.result?.blockers ?? null,
      proposals: doc.result?.proposals ?? null,
      submittedAt: doc.result?.submitted_at ?? null,
      updatedAt: doc.result?.updated_at ?? null
    }
  };
}

/** Kế hoạch KPI năm — có kế hoạch = phải nộp báo cáo ngày từ `effectiveFrom`. */
export async function listKpiPlans(
  appId: string,
  year: number,
  employeeIds?: string[]
): Promise<KpiPlanView[]> {
  const docs = (await KpiPlanModel.find({
    app_id: appId,
    year,
    isDeleted: false,
    ...(employeeIds ? { employee_id: { $in: employeeIds } } : {})
  }).lean()) as any[];
  return docs.map((doc) => ({
    employeeId: String(doc.employee_id),
    year: doc.year,
    templateCode: isKpiTemplateCode(doc.template_code) ? doc.template_code : DEFAULT_TEMPLATE,
    effectiveFrom: doc.effective_from,
    decisionRef: doc.decision_ref ?? null,
    targets: new Map(
      (doc.targets ?? []).map((t: any) => [
        t.metric_code,
        { annual: t.annual, monthly: t.monthly ?? [] } as MetricTarget
      ])
    )
  }));
}

/** Phiếu báo cáo trong đoạn [fromKey, toKey] (gồm 2 đầu). */
export async function listDailyReports(
  appId: string,
  fromKey: string,
  toKey: string,
  employeeIds?: string[]
): Promise<DailyReportView[]> {
  const docs = (await DailyReportModel.find({
    app_id: appId,
    isDeleted: false,
    report_date: { $gte: fromKey, $lte: toKey },
    ...(employeeIds ? { employee_id: { $in: employeeIds } } : {})
  }).lean()) as any[];
  return docs.map(toDailyReportView);
}

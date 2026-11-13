import { Mapper } from "../../../core/db/mongoose-repository.base";
import { DailyReportEntity, DailyReportProps, MetricValue } from "../domain/daily-report.entity";

const valueToDomain = (item: any): MetricValue => ({
  metricCode: item.metric_code,
  value: item.value,
  note: item.note ?? null
});

const valueToPersistence = (item: MetricValue) => ({
  metric_code: item.metricCode,
  value: item.value,
  note: item.note
});

export const dailyReportMapper: Mapper<DailyReportEntity, any> = {
  toDomain(record) {
    return new DailyReportEntity(
      {
        id: String(record._id),
        props: {
          appId: String(record.app_id),
          employeeId: String(record.employee_id),
          departmentId: record.department_id ? String(record.department_id) : null,
          reportDate: record.report_date,
          plan: {
            targets: (record.plan?.targets ?? []).map(valueToDomain),
            note: record.plan?.note ?? null,
            submittedAt: record.plan?.submitted_at ?? null,
            updatedAt: record.plan?.updated_at ?? null
          },
          result: {
            values: (record.result?.values ?? []).map(valueToDomain),
            achievements: record.result?.achievements ?? null,
            blockers: record.result?.blockers ?? null,
            proposals: record.result?.proposals ?? null,
            submittedAt: record.result?.submitted_at ?? null,
            updatedAt: record.result?.updated_at ?? null
          }
        } as DailyReportProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const p = entity.getProps();
    return {
      _id: p.id,
      app_id: p.appId,
      employee_id: p.employeeId,
      department_id: p.departmentId,
      report_date: p.reportDate,
      plan: {
        targets: p.plan.targets.map(valueToPersistence),
        note: p.plan.note,
        submitted_at: p.plan.submittedAt,
        updated_at: p.plan.updatedAt
      },
      result: {
        values: p.result.values.map(valueToPersistence),
        achievements: p.result.achievements,
        blockers: p.result.blockers,
        proposals: p.result.proposals,
        submitted_at: p.result.submittedAt,
        updated_at: p.result.updatedAt
      }
    };
  }
};

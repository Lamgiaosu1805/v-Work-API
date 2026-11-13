import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException, ForbiddenException } from "../../../core/exceptions/exceptions";
import { deadlineOf, parseDateKey, toDateKey } from "./report-calendar";

// Phiếu báo cáo ngày của 1 Sale (docs/CRM-DAILY-REPORT-FLOWS.md mục 5, Q10):
// - chỉ báo cáo cho ngày hôm nay;
// - kế hoạch sửa được tới giờ chốt 17:30;
// - kết quả: đã nộp trước 17:30 thì sau 17:30 khoá; chưa nộp thì vẫn nộp được tới hết ngày (ghi "trễ").
// Giờ nộp lần đầu được giữ nguyên để tính đúng hạn.

const MAX_TEXT = 2000;
const MAX_VALUE = 1e13;

export interface MetricValue {
  metricCode: string;
  value: number;
  note: string | null;
}

export interface DailyReportPlan {
  targets: MetricValue[];
  note: string | null;
  submittedAt: Date | null;
  updatedAt: Date | null;
}

export interface DailyReportResult {
  values: MetricValue[];
  achievements: string | null;
  blockers: string | null;
  proposals: string | null;
  submittedAt: Date | null;
  updatedAt: Date | null;
}

export interface DailyReportProps {
  appId: string;
  employeeId: string;
  departmentId: string | null;
  reportDate: string;
  plan: DailyReportPlan;
  result: DailyReportResult;
}

function cleanText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ArgumentInvalidException(`${field} không hợp lệ`);
  const text = value.trim();
  if (text.length > MAX_TEXT) {
    throw new ArgumentInvalidException(`${field} tối đa ${MAX_TEXT} ký tự`);
  }
  return text || null;
}

function cleanValues(
  values: unknown,
  allowedMetrics: readonly string[],
  field: string
): MetricValue[] {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new ArgumentInvalidException(`${field} phải là danh sách`);
  const seen = new Set<string>();
  return values.map((item: any) => {
    const metricCode = item?.metricCode ?? item?.metric_code;
    if (!allowedMetrics.includes(metricCode)) {
      throw new ArgumentInvalidException(`Chỉ tiêu "${metricCode}" không thuộc phần được nhập`);
    }
    if (seen.has(metricCode)) {
      throw new ArgumentInvalidException(`Chỉ tiêu "${metricCode}" bị nhập trùng`);
    }
    seen.add(metricCode);
    const value = Number(item?.value);
    if (!Number.isFinite(value) || value < 0 || value > MAX_VALUE) {
      throw new ArgumentInvalidException(`Giá trị của "${metricCode}" phải là số không âm`);
    }
    return { metricCode, value, note: cleanText(item?.note, `Ghi chú "${metricCode}"`) };
  });
}

export class DailyReportEntity extends Entity<DailyReportProps> {
  static create(
    id: string,
    input: { appId: string; employeeId: string; departmentId: string | null; reportDate: string }
  ): DailyReportEntity {
    return new DailyReportEntity({
      id,
      props: {
        ...input,
        plan: { targets: [], note: null, submittedAt: null, updatedAt: null },
        result: {
          values: [],
          achievements: null,
          blockers: null,
          proposals: null,
          submittedAt: null,
          updatedAt: null
        }
      }
    });
  }

  get reportDate(): string {
    return this.props.reportDate;
  }

  validate(): void {
    parseDateKey(this.props.reportDate);
    if (!this.props.appId || !this.props.employeeId) {
      throw new ArgumentInvalidException("Phiếu báo cáo thiếu app hoặc nhân viên");
    }
  }

  private assertToday(now: Date): void {
    if (toDateKey(now) !== this.props.reportDate) {
      throw new ArgumentInvalidException("Chỉ được báo cáo cho ngày hôm nay");
    }
  }

  savePlan(
    input: { targets: unknown; note: unknown },
    allowedMetrics: readonly string[],
    now: Date
  ): void {
    this.assertToday(now);
    if (now.getTime() > deadlineOf(this.props.reportDate, "result").getTime()) {
      throw new ForbiddenException("Đã qua giờ chốt sổ 17:30, không sửa được kế hoạch ngày");
    }
    this._setProps({
      plan: {
        targets: cleanValues(input.targets, allowedMetrics, "Mục tiêu"),
        note: cleanText(input.note, "Ghi chú kế hoạch"),
        submittedAt: this.props.plan.submittedAt ?? now,
        updatedAt: now
      }
    });
  }

  submitResult(
    input: { values: unknown; achievements: unknown; blockers: unknown; proposals: unknown },
    allowedMetrics: readonly string[],
    now: Date
  ): void {
    this.assertToday(now);
    const deadline = deadlineOf(this.props.reportDate, "result");
    if (this.props.result.submittedAt && now.getTime() > deadline.getTime()) {
      throw new ForbiddenException("Báo cáo đã chốt sổ lúc 17:30, không sửa được");
    }
    this._setProps({
      result: {
        values: cleanValues(input.values, allowedMetrics, "Kết quả"),
        achievements: cleanText(input.achievements, "Kết quả nổi bật"),
        blockers: cleanText(input.blockers, "Khó khăn"),
        proposals: cleanText(input.proposals, "Đề xuất"),
        submittedAt: this.props.result.submittedAt ?? now,
        updatedAt: now
      }
    });
  }
}

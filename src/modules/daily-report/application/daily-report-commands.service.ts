import mongoose from "mongoose";
import { ConflictException } from "../../../core/exceptions/exceptions";
import { DailyReportEntity } from "../domain/daily-report.entity";
import { KpiTemplateCode, manualMetrics, plannableMetrics } from "../domain/kpi-metrics";
import { toDateKey } from "../domain/report-calendar";
import { DailyReportRepository } from "../infrastructure/daily-report.repository";
import { dailyReportMapper } from "../infrastructure/daily-report.mapper";
import { DailyReportView, toDailyReportView } from "./daily-report-queries.service";

const repository = new DailyReportRepository();

export interface ReportWriteContext {
  appId: string;
  employeeId: string;
  departmentId: string | null; // TTKD hiện tại — chỉ chụp khi tạo phiếu lần đầu trong ngày
  templateCode: KpiTemplateCode;
  now: Date;
}

async function loadOrCreate(ctx: ReportWriteContext): Promise<DailyReportEntity> {
  const reportDate = toDateKey(ctx.now);
  const existing = await repository.findByEmployeeAndDate(ctx.appId, ctx.employeeId, reportDate);
  return (
    existing ??
    DailyReportEntity.create(new mongoose.Types.ObjectId().toString(), {
      appId: ctx.appId,
      employeeId: ctx.employeeId,
      departmentId: ctx.departmentId,
      reportDate
    })
  );
}

async function persist(entity: DailyReportEntity): Promise<DailyReportView> {
  try {
    await repository.upsert(entity);
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new ConflictException("Phiếu báo cáo vừa được lưu ở nơi khác, vui lòng tải lại");
    }
    throw err;
  }
  return toDailyReportView(dailyReportMapper.toPersistence(entity));
}

/** Lưu / sửa kế hoạch ngày (mục tiêu từng chỉ tiêu + ghi chú). */
export async function saveDailyReportPlan(
  ctx: ReportWriteContext,
  input: { targets: unknown; note: unknown }
): Promise<DailyReportView> {
  const entity = await loadOrCreate(ctx);
  entity.savePlan(input, plannableMetrics(ctx.templateCode), ctx.now);
  return persist(entity);
}

/** Nộp / sửa kết quả ngày (số nhập tay + giải trình). */
export async function submitDailyReportResult(
  ctx: ReportWriteContext,
  input: { values: unknown; achievements: unknown; blockers: unknown; proposals: unknown }
): Promise<DailyReportView> {
  const entity = await loadOrCreate(ctx);
  entity.submitResult(input, manualMetrics(ctx.templateCode), ctx.now);
  return persist(entity);
}

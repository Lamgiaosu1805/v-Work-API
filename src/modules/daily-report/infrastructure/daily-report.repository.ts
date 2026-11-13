import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import DailyReportModel from "../../../models/DailyReportModel";
import { DailyReportEntity } from "../domain/daily-report.entity";
import { dailyReportMapper } from "./daily-report.mapper";

export class DailyReportRepository extends MongooseRepositoryBase<DailyReportEntity, any> {
  constructor() {
    super(DailyReportModel, dailyReportMapper);
  }

  async findByEmployeeAndDate(
    appId: string,
    employeeId: string,
    reportDate: string
  ): Promise<DailyReportEntity | null> {
    const doc = await this.model
      .findOne({
        app_id: appId,
        employee_id: employeeId,
        report_date: reportDate,
        isDeleted: false
      })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async upsert(entity: DailyReportEntity): Promise<void> {
    const existing = await this.model
      .findOne({ _id: entity.id })
      .session(this.session ?? null)
      .lean();
    if (existing) await this.updateById(entity.id, entity);
    else await this.insert(entity);
  }
}

import { ClientSession } from "mongoose";
import WorkDayStatusModel from "../../../models/WorkDayStatusModel";
import { RequestContextService } from "../../../core/context/request-context";
import { ATTENDANCE_DRIVEN_STATUSES, WorkDayStatus } from "../domain/work-day-status-rules";
import { LeaveStatusSnapshot } from "../domain/resolve-leave-conflict";

export interface ApplyAttendanceDrivenStatusInput {
  userId: string;
  worksheetId: string;
  dayStart: Date;
  dayEnd: Date;
  morningStatus: WorkDayStatus;
  afternoonStatus: WorkDayStatus;
}

export class WorkDayStatusRepository {
  // eslint-disable-next-line class-methods-use-this
  private resolveSession(session?: ClientSession): ClientSession | undefined {
    return session ?? (RequestContextService.getTransactionSession() as ClientSession | undefined);
  }

  async applyAttendanceDrivenStatus(
    input: ApplyAttendanceDrivenStatusInput,
    session?: ClientSession
  ): Promise<void> {
    const { userId, worksheetId, dayStart, dayEnd, morningStatus, afternoonStatus } = input;
    const resolvedSession = this.resolveSession(session);

    if (morningStatus === afternoonStatus) {
      const newStatus = morningStatus;
      await WorkDayStatusModel.deleteMany(
        {
          user_id: userId,
          date: { $gte: dayStart, $lt: dayEnd },
          status: { $in: ATTENDANCE_DRIVEN_STATUSES },
          period: { $ne: "full" },
          isDeleted: false
        },
        { session: resolvedSession }
      );
      await WorkDayStatusModel.updateOne(
        { user_id: userId, date: dayStart, period: "full" },
        {
          $set: { status: newStatus },
          $setOnInsert: {
            worksheet_id: worksheetId,
            sources: [{ ref_id: worksheetId, ref_type: "attendance" }],
            isDeleted: false
          }
        },
        { upsert: true, session: resolvedSession }
      );
    } else {
      await WorkDayStatusModel.deleteMany(
        {
          user_id: userId,
          date: { $gte: dayStart, $lt: dayEnd },
          status: { $in: ATTENDANCE_DRIVEN_STATUSES }
        },
        { session: resolvedSession }
      );
      const periodStatuses: [string, WorkDayStatus][] = [
        ["morning", morningStatus],
        ["afternoon", afternoonStatus]
      ];
      for (const [period, st] of periodStatuses) {
        // eslint-disable-next-line no-await-in-loop
        await WorkDayStatusModel.updateOne(
          { user_id: userId, date: dayStart, period },
          {
            $setOnInsert: {
              worksheet_id: worksheetId,
              status: st,
              sources: [{ ref_id: worksheetId, ref_type: "attendance" }],
              isDeleted: false
            }
          },
          { upsert: true, session: resolvedSession }
        );
      }
    }
  }

  async findLeaveStatusesForDay(
    userId: string,
    dayStart: Date,
    dayEnd: Date,
    session?: ClientSession
  ): Promise<LeaveStatusSnapshot[]> {
    const docs = await WorkDayStatusModel.find({
      user_id: userId,
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ["leave_paid", "leave_unpaid"] },
      isDeleted: false
    })
      .session(this.resolveSession(session) ?? null)
      .lean();

    return docs.map((d) => ({
      id: d._id.toString(),
      period: d.period as LeaveStatusSnapshot["period"],
      status: d.status as LeaveStatusSnapshot["status"],
      date: d.date
    }));
  }

  async markStatusesPresent(
    statusIds: string[],
    worksheetId: string,
    session?: ClientSession
  ): Promise<void> {
    if (!statusIds.length) return;
    const resolvedSession = this.resolveSession(session);
    for (const id of statusIds) {
      // eslint-disable-next-line no-await-in-loop
      await WorkDayStatusModel.findByIdAndUpdate(
        id,
        {
          status: "present",
          worksheet_id: worksheetId,
          $addToSet: { sources: { ref_id: worksheetId, ref_type: "attendance" } }
        },
        { session: resolvedSession }
      );
    }
  }

  // Port nguyên AttendanceController.checkOut's WorkDayStatusModel.updateMany({status:"pending"}) —
  // KHÁC markStatusesPresent (scope theo statusId cụ thể, dùng cho flip leave-conflict): đây flip TẤT
  // CẢ status "pending" (attendance-driven, chưa có chấm công) của 1 worksheet thành "present" ngay khi
  // check-out xong, không liên quan gì tới leave conflict. Bắt buộc sống ở Timesheet (không phải
  // attendance) theo luật "1 owner cho WorkDayStatus" (mục 13) — thuộc phạm vi mở rộng cần thiết của
  // task 1.8.4.8, không có trong danh sách liệt kê ban đầu của task đó.
  async markPendingAsPresent(worksheetId: string, session?: ClientSession): Promise<void> {
    await WorkDayStatusModel.updateMany(
      { worksheet_id: worksheetId, status: "pending", isDeleted: false },
      {
        status: "present",
        $addToSet: { sources: { ref_id: worksheetId, ref_type: "attendance" } }
      },
      { session: this.resolveSession(session) }
    );
  }
}

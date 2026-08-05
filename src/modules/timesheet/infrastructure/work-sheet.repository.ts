import mongoose, { ClientSession } from "mongoose";
import moment from "moment-timezone";
import WorkSheetModel from "../../../models/WorkSheetModel";
// Side-effect import: .populate("shifts") bên dưới cần model "shift" đã được đăng ký với mongoose.
// Trong app thật mọi model được require ở tầng khởi động nên luôn có sẵn, nhưng file này phụ thuộc
// vào "shift" một cách ngầm định (chỉ qua populate) — import tường minh để không phụ thuộc thứ tự
// require ngẫu nhiên của caller (phát hiện lúc cutover: 1 test file không require ShiftModel ở đâu
// khác trong chain của nó thì populate lỗi "Schema hasn't been registered for model 'shift'").
import "../../../models/ShiftModel";
import { RequestContextService } from "../../../core/context/request-context";
import { ShiftInfo, WorksheetSnapshot } from "../domain/types";

const TZ = "Asia/Ho_Chi_Minh";

export interface WorkSheetRecord extends WorksheetSnapshot {
  id: string;
  user_id: string;
  date: Date;
}

export interface WorkSheetComputedUpdate {
  check_in: Date | null;
  check_out: Date | null;
  minutes_late: number;
  minute_early: number;
  work_unit: number;
  penalty_amount: number;
}

export interface RawPunchUpdate {
  check_in?: Date;
  check_out?: Date;
  minutes_late?: number;
  minute_early?: number;
}

interface WorkSheetLeanDoc {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  date: Date;
  check_in: Date | null;
  check_out: Date | null;
  minutes_late?: number;
  minute_early?: number;
  work_unit?: number | null;
  penalty_amount?: number;
  shifts?: { start_time: string; end_time: string }[];
}

function toRecord(doc: WorkSheetLeanDoc): WorkSheetRecord {
  return {
    id: doc._id.toString(),
    user_id: doc.user_id.toString(),
    date: doc.date,
    check_in: doc.check_in,
    check_out: doc.check_out,
    minutes_late: doc.minutes_late,
    minute_early: doc.minute_early,
    work_unit: doc.work_unit,
    penalty_amount: doc.penalty_amount,
    shifts: doc.shifts?.map((s): ShiftInfo => ({ start_time: s.start_time, end_time: s.end_time }))
  };
}

export class WorkSheetRepository {
  // eslint-disable-next-line class-methods-use-this
  private resolveSession(session?: ClientSession): ClientSession | undefined {
    return session ?? (RequestContextService.getTransactionSession() as ClientSession | undefined);
  }

  async findByUserAndDate(
    userId: string,
    date: Date,
    session?: ClientSession
  ): Promise<WorkSheetRecord | null> {
    const dateKey = moment.tz(date, TZ).format("YYYY-MM-DD");
    const dayStart = moment.tz(dateKey, TZ).startOf("day").toDate();
    const dayEnd = moment.tz(dateKey, TZ).add(1, "day").startOf("day").toDate();

    const doc = await WorkSheetModel.findOne({
      user_id: userId,
      date: { $gte: dayStart, $lt: dayEnd },
      isDeleted: false
    })
      .populate("shifts")
      .session(this.resolveSession(session) ?? null)
      .lean();

    return doc ? toRecord(doc as unknown as WorkSheetLeanDoc) : null;
  }

  async applyComputedResult(
    id: string,
    update: WorkSheetComputedUpdate,
    session?: ClientSession
  ): Promise<void> {
    await WorkSheetModel.updateOne(
      { _id: id },
      {
        $set: {
          check_in: update.check_in,
          check_out: update.check_out,
          minutes_late: update.minutes_late,
          minute_early: update.minute_early,
          work_unit: update.work_unit,
          penalty_amount: update.penalty_amount
        }
      },
      { session: this.resolveSession(session) }
    );
  }

  async upsertRawPunch(
    userId: string,
    date: Date,
    clockUpdate: RawPunchUpdate,
    session?: ClientSession
  ): Promise<WorkSheetRecord> {
    const dateKey = moment.tz(date, TZ).format("YYYY-MM-DD");
    const dayStart = moment.tz(dateKey, TZ).startOf("day").toDate();
    const dayEnd = moment.tz(dateKey, TZ).add(1, "day").startOf("day").toDate();
    const resolvedSession = this.resolveSession(session);

    const update: Record<string, Date | number> = {};
    if (clockUpdate.check_in) update.check_in = clockUpdate.check_in;
    if (clockUpdate.check_out) update.check_out = clockUpdate.check_out;
    if (clockUpdate.minutes_late !== undefined) update.minutes_late = clockUpdate.minutes_late;
    if (clockUpdate.minute_early !== undefined) update.minute_early = clockUpdate.minute_early;

    const updated = await WorkSheetModel.findOneAndUpdate(
      { user_id: userId, date: { $gte: dayStart, $lt: dayEnd }, isDeleted: false },
      update,
      { session: resolvedSession, new: true }
    );

    if (!updated) {
      await WorkSheetModel.create([{ user_id: userId, date: dayStart, shifts: [], ...update }], {
        session: resolvedSession
      });
    }

    const record = await this.findByUserAndDate(userId, dayStart, session);
    if (!record) {
      throw new Error(
        "upsertRawPunch: worksheet không tồn tại ngay sau khi upsert (không nên xảy ra)"
      );
    }
    return record;
  }
}

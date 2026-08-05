import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import WorkSheetModel from "../../../src/models/WorkSheetModel";
import WorkDayStatusModel from "../../../src/models/WorkDayStatusModel";
import ShiftModel from "../../../src/models/ShiftModel";
import {
  resolveAttendanceDay,
  ResolveAttendanceDayComputed
} from "../../../src/modules/timesheet/domain/resolve-attendance-day";
import { persistAttendanceDay } from "../../../src/modules/timesheet/application/persist-attendance-day";

const DATE_KEY = "2026-07-01"; // thứ 4

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await ShiftModel.deleteMany({});
});

const stubLatePenalty = () => ({ work_unit: 1, penalty_amount: 0, morning_absent: false });
const stubEarlyPenalty = () => ({ work_unit: 1, penalty_amount: 0, afternoon_absent: false });
const stubForgotPenalty = () => ({ work_unit: 1, penalty_amount: 0 });

describe("persistAttendanceDay", () => {
  test("ghi đúng field worksheet đã tính, tạo status 'full' present khi cả 2 buổi đều present", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const worksheet = await WorkSheetModel.create({
      user_id: userId,
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    const computed = resolveAttendanceDay({
      dateKey: DATE_KEY,
      rawIn: "08:01",
      rawOut: "17:31",
      worksheet: {
        check_in: null,
        check_out: null,
        shifts: [{ start_time: "08:00", end_time: "17:30" }]
      },
      forgotMap: new Map(),
      forgotOccurrenceMap: new Map(),
      lateForgivenSet: new Set(),
      earlyForgivenSet: new Set(),
      leavePeriodsMap: new Map(),
      resolveLatePenalty: stubLatePenalty,
      resolveEarlyPenalty: stubEarlyPenalty,
      resolveForgotPenalty: stubForgotPenalty
    }) as ResolveAttendanceDayComputed;

    const result = await persistAttendanceDay({
      userId: userId.toString(),
      worksheetId: worksheet._id.toString(),
      dateKey: DATE_KEY,
      computed
    });

    expect(result.leaveRefundAmount).toBe(0);

    const updatedWorksheet = await WorkSheetModel.findById(worksheet._id).lean();
    expect(updatedWorksheet?.work_unit).toBe(1);
    expect(updatedWorksheet?.check_in).toEqual(computed.newCheckIn);
    expect(updatedWorksheet?.check_out).toEqual(computed.newCheckOut);

    const statuses = await WorkDayStatusModel.find({ user_id: userId }).lean();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].period).toBe("full");
    expect(statuses[0].status).toBe("present");
  });

  test("nhân viên có leave_paid buổi sáng nhưng vẫn check-in sớm che phủ: hoàn phép đúng, trạng thái cuối cùng vẫn present (leave-conflict transient bị period-status ghi đè lại đúng giá trị)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const worksheet = await WorkSheetModel.create({
      user_id: userId,
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    // seed leave_paid buổi sáng đã có trước (nhân viên xin nghỉ sáng)
    const leaveDoc = await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: new mongoose.Types.ObjectId(),
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      period: "morning",
      status: "leave_paid",
      sources: []
    });

    const leavePeriodsMap = new Map([[DATE_KEY, new Set(["morning"])]]);

    // Nhân viên vẫn check-in đầy đủ cả ngày (che phủ cả buổi sáng đã xin nghỉ)
    const computed = resolveAttendanceDay({
      dateKey: DATE_KEY,
      rawIn: "08:01",
      rawOut: "17:31",
      worksheet: {
        check_in: null,
        check_out: null,
        shifts: [{ start_time: "08:00", end_time: "17:30" }]
      },
      forgotMap: new Map(),
      forgotOccurrenceMap: new Map(),
      lateForgivenSet: new Set(),
      earlyForgivenSet: new Set(),
      leavePeriodsMap,
      resolveLatePenalty: stubLatePenalty,
      resolveEarlyPenalty: stubEarlyPenalty,
      resolveForgotPenalty: stubForgotPenalty
    }) as ResolveAttendanceDayComputed;

    // resolveAttendanceDay tự override leaveMorning=false (check-in trước 12h) -> không mất công
    expect(computed.work_unit).toBe(1);
    expect(computed.morning_absent).toBe(false);
    expect(computed.statusMissedIn).toBe(false);

    const result = await persistAttendanceDay({
      userId: userId.toString(),
      worksheetId: worksheet._id.toString(),
      dateKey: DATE_KEY,
      computed
    });

    // Hoàn 0.5 ngày phép vì leave_paid buổi sáng bị check-in thật đè lên
    expect(result.leaveRefundAmount).toBe(0.5);

    // Trạng thái cuối cùng: cả 2 buổi present -> gộp thành 1 doc period="full", status="present".
    // Doc leave_paid gốc (đã bị markStatusesPresent flip tạm) đã bị applyAttendanceDrivenStatus xoá
    // đi (vì lúc đó status của nó là "present", nằm trong ATTENDANCE_DRIVEN_STATUSES) và thay bằng
    // đúng 1 doc "full" — không còn sót lại doc "morning" nào, không trùng lặp.
    const statuses = await WorkDayStatusModel.find({ user_id: userId }).lean();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].period).toBe("full");
    expect(statuses[0].status).toBe("present");

    const oldLeaveDoc = await WorkDayStatusModel.findById(leaveDoc._id);
    expect(oldLeaveDoc).toBeNull(); // bị xoá bởi applyAttendanceDrivenStatus, không còn tồn tại
  });

  test("nhân viên xin nghỉ cả ngày (leave_paid full) và KHÔNG check-in: không có leave-conflict, work_unit=0 do skip", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await WorkSheetModel.create({
      user_id: userId,
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: new mongoose.Types.ObjectId(),
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      period: "full",
      status: "leave_paid",
      sources: []
    });

    const computed = resolveAttendanceDay({
      dateKey: DATE_KEY,
      rawIn: null,
      rawOut: null,
      worksheet: {
        check_in: null,
        check_out: null,
        shifts: [{ start_time: "08:00", end_time: "17:30" }]
      },
      forgotMap: new Map(),
      forgotOccurrenceMap: new Map(),
      lateForgivenSet: new Set(),
      earlyForgivenSet: new Set(),
      leavePeriodsMap: new Map(),
      resolveLatePenalty: stubLatePenalty,
      resolveEarlyPenalty: stubEarlyPenalty,
      resolveForgotPenalty: stubForgotPenalty
    });

    // Không có rawIn/rawOut và không forgot -> skip:true, persistAttendanceDay không được gọi
    // (đúng behavior gốc — caller kiểm tra computed.skip trước khi gọi saveAttendanceDay).
    expect(computed.skip).toBe(true);
  });
});

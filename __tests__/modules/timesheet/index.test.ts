import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import WorkSheetModel from "../../../src/models/WorkSheetModel";
import WorkDayStatusModel from "../../../src/models/WorkDayStatusModel";
import ShiftModel from "../../../src/models/ShiftModel";
import { processAttendanceDay, getWorksheetForDay } from "../../../src/modules/timesheet";

const DATE_KEY = "2026-07-01";

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

describe("modules/timesheet public API", () => {
  test("getWorksheetForDay + processAttendanceDay: luồng đầy đủ qua public API, không import path nội bộ", async () => {
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

    const found = await getWorksheetForDay(
      userId.toString(),
      new Date(`${DATE_KEY}T00:00:00.000Z`)
    );
    expect(found?.id).toBe(worksheet._id.toString());
    expect(found?.shifts).toEqual([{ start_time: "08:00", end_time: "17:30" }]);

    const result = await processAttendanceDay({
      userId: userId.toString(),
      worksheetId: worksheet._id.toString(),
      dateKey: DATE_KEY,
      rawIn: "08:01",
      rawOut: "17:31",
      worksheet: {
        check_in: found?.check_in ?? null,
        check_out: found?.check_out ?? null,
        shifts: found?.shifts
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

    expect(result.skip).toBe(false);
    expect(result.leaveRefundAmount).toBe(0);

    const updated = await WorkSheetModel.findById(worksheet._id).lean();
    expect(updated?.work_unit).toBe(1);
  });

  test("processAttendanceDay: không có raw data và không forgot -> skip=true, không ghi gì", async () => {
    const userId = new mongoose.Types.ObjectId();
    const worksheet = await WorkSheetModel.create({
      user_id: userId,
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      check_in: null,
      check_out: null
    });

    const result = await processAttendanceDay({
      userId: userId.toString(),
      worksheetId: worksheet._id.toString(),
      dateKey: DATE_KEY,
      rawIn: null,
      rawOut: null,
      worksheet: { check_in: null, check_out: null, shifts: [] },
      forgotMap: new Map(),
      forgotOccurrenceMap: new Map(),
      lateForgivenSet: new Set(),
      earlyForgivenSet: new Set(),
      leavePeriodsMap: new Map(),
      resolveLatePenalty: stubLatePenalty,
      resolveEarlyPenalty: stubEarlyPenalty,
      resolveForgotPenalty: stubForgotPenalty
    });

    expect(result).toEqual({ skip: true });
    const unchanged = await WorkSheetModel.findById(worksheet._id).lean();
    expect(unchanged?.work_unit).toBeNull();
  });
});

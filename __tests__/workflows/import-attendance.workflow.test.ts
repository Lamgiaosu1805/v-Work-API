import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import WorkSheetModel from "../../src/models/WorkSheetModel";
import WorkDayStatusModel from "../../src/models/WorkDayStatusModel";
import ShiftModel from "../../src/models/ShiftModel";
import { RequestModel, LateEarlyRequest } from "../../src/models/RequestModel";
import { getPayrollPeriodRange } from "../../src/helpers/payrollPeriod";
import { buildAttendanceContext } from "../../src/workflows/import-attendance.workflow";
// eslint-disable-next-line import/no-unresolved
const { buildUserDayContext } = require("../../src/jobs/finalizeWorkDay");

const TZ = "Asia/Ho_Chi_Minh";
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
  await RequestModel.deleteMany({});
  await ShiftModel.deleteMany({});
});

function toPlainMapOfSets(map: Map<string, Set<string>>) {
  return [...map.entries()].map(([k, v]) => [k, [...v].sort()]);
}

// Verify quan trọng nhất của task 1.8.5.5: buildAttendanceContext (workflow mới, gộp 2 bản trùng lặp)
// khi gọi với excelRawByDate rỗng phải ra kết quả GIỐNG HỆT buildUserDayContext gốc (jobs/finalizeWorkDay.js)
// trên cùng 1 input — differential test, không suy đoán.
describe("buildAttendanceContext — differential test so với buildUserDayContext gốc (excelRawByDate rỗng)", () => {
  test("cùng input, cùng dữ liệu seed -> kết quả identical (trừ forgotMap/leaveStatuses là Mongoose doc, so theo dateKey)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const today = moment.tz(DATE_KEY, TZ).startOf("day").toDate();
    const todayStart = moment.tz(DATE_KEY, TZ).startOf("day");
    const todayEnd = moment.tz(DATE_KEY, TZ).endOf("day");
    const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(today);

    await WorkSheetModel.create({
      user_id: userId,
      date: today,
      check_in: moment.tz(DATE_KEY, TZ).hour(8).toDate(),
      check_out: null // thiếu check-out -> partial -> ứng viên forgotOccurrence tự phát hiện
    });
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await LateEarlyRequest.create({
      user_id: userId,
      date: today,
      shift_id: shift._id,
      type: "late",
      minutes: 20,
      status: "approved",
      reason: "kẹt xe"
    });
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: new mongoose.Types.ObjectId(),
      date: today,
      period: "afternoon",
      status: "leave_paid",
      sources: []
    });

    const oldResult = await buildUserDayContext(
      userId,
      DATE_KEY,
      todayStart.toDate(),
      todayEnd.toDate(),
      periodStart,
      periodEnd
    );
    const newResult = await buildAttendanceContext({
      userId: userId.toString(),
      rangeStart: todayStart.toDate(),
      rangeEnd: todayEnd.toDate(),
      periodStart,
      periodEnd
    });

    expect([...newResult.forgotMap.keys()]).toEqual([...oldResult.forgotMap.keys()]);
    expect([...newResult.forgotOccurrenceMap.entries()]).toEqual([
      ...oldResult.forgotOccurrenceMap.entries()
    ]);
    expect([...newResult.lateForgivenSet]).toEqual([...oldResult.lateForgivenSet]);
    expect([...newResult.earlyForgivenSet]).toEqual([...oldResult.earlyForgivenSet]);
    expect(toPlainMapOfSets(newResult.leavePeriodsMap)).toEqual(
      toPlainMapOfSets(oldResult.leavePeriodsMap)
    );
  });

  test("không có gì trong DB -> cả 2 bản đều trả context rỗng giống nhau", async () => {
    const userId = new mongoose.Types.ObjectId();
    const today = moment.tz(DATE_KEY, TZ).startOf("day").toDate();
    const todayStart = moment.tz(DATE_KEY, TZ).startOf("day");
    const todayEnd = moment.tz(DATE_KEY, TZ).endOf("day");
    const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(today);

    const oldResult = await buildUserDayContext(
      userId,
      DATE_KEY,
      todayStart.toDate(),
      todayEnd.toDate(),
      periodStart,
      periodEnd
    );
    const newResult = await buildAttendanceContext({
      userId: userId.toString(),
      rangeStart: todayStart.toDate(),
      rangeEnd: todayEnd.toDate(),
      periodStart,
      periodEnd
    });

    expect(newResult.forgotMap.size).toBe(0);
    expect(oldResult.forgotMap.size).toBe(0);
    expect(newResult.forgotOccurrenceMap.size).toBe(0);
    expect(oldResult.forgotOccurrenceMap.size).toBe(0);
  });
});

describe("buildAttendanceContext — excelRawByDate (importExcel-only path)", () => {
  test("có excelRawByDate: ngày chỉ có dữ liệu máy (không worksheet) vẫn được tính vào daySnapshots/forgotOccurrenceMap", async () => {
    const userId = new mongoose.Types.ObjectId();
    const today = moment.tz(DATE_KEY, TZ).startOf("day").toDate();
    const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(today);

    // Không tạo WorkSheetModel nào -> daySnapshots trước đây (excelRawByDate rỗng) sẽ KHÔNG có ngày này.
    const withoutExcel = await buildAttendanceContext({
      userId: userId.toString(),
      rangeStart: today,
      rangeEnd: moment.tz(DATE_KEY, TZ).endOf("day").toDate(),
      periodStart,
      periodEnd
    });
    expect(withoutExcel.forgotOccurrenceMap.size).toBe(0);

    // Có excelRawByDate (chỉ check-in, thiếu check-out) -> ngày này lọt vào daySnapshots là "partial"
    // -> forgotOccurrenceMap tự phát hiện (giống hệt cách importExcel merge dữ liệu máy vào).
    const withExcel = await buildAttendanceContext({
      userId: userId.toString(),
      rangeStart: today,
      rangeEnd: moment.tz(DATE_KEY, TZ).endOf("day").toDate(),
      periodStart,
      periodEnd,
      excelRawByDate: new Map([[DATE_KEY, { rawIn: "08:01", rawOut: null }]])
    });
    expect(withExcel.forgotOccurrenceMap.size).toBe(1);
    expect(withExcel.forgotOccurrenceMap.get(DATE_KEY)).toEqual({
      occurrence: 1,
      hasRequest: false
    });
  });
});

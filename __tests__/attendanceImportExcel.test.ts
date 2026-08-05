import mongoose from "mongoose";
import moment from "moment-timezone";
import xlsx from "xlsx";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import AttendanceMachineMappingModel from "../src/models/AttendanceMachineMappingModel";
import UserInfoModel from "../src/models/UserInfoModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import ShiftModel from "../src/models/ShiftModel";
import AttendancePenaltyModel from "../src/models/AttendancePenaltyModel";
import { RequestModel } from "../src/models/RequestModel";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  // Xem lý do bắt buộc ở __tests__/attendanceCheckOut.test.ts — chờ Mongoose build xong index nền
  // cho mọi model TRƯỚC khi chạy test có transaction/nhiều query liên tiếp bên trong 1 request.
  await Promise.all([
    AttendanceMachineMappingModel.init(),
    UserInfoModel.init(),
    WorkSheetModel.init(),
    WorkDayStatusModel.init(),
    ShiftModel.init(),
    AttendancePenaltyModel.init(),
    RequestModel.init()
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await AttendanceMachineMappingModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await ShiftModel.deleteMany({});
  await AttendancePenaltyModel.deleteMany({});
  await RequestModel.deleteMany({});
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

// Dựng file Excel tối thiểu đúng định dạng parseExcelToBlocks/parseDayRows mong đợi: hàng "Mã nhân
// viên: XXXX" đánh dấu bắt đầu 1 block, các hàng sau là ngày (DD/MM/YYYY) + giờ vào/ra ở cột 2/7.
function buildExcelBuffer(
  rows: { machineCode: string; days: { dateStr: string; inTime?: string; outTime?: string }[] }[]
): Buffer {
  const aoa: string[][] = [];
  for (const block of rows) {
    aoa.push([`Mã nhân viên: ${block.machineCode}`, "", "", "", "", "", "", ""]);
    for (const d of block.days) {
      aoa.push([d.dateStr, "", d.inTime ?? "", "", "", "", "", d.outTime ?? ""]);
    }
  }
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

// Chưa từng có test nào cho AttendanceController.importExcel trước khi cutover (task 1.8.3.6) —
// characterization test mới, tập trung vào phần vừa cutover (processAttendanceDay thay
// resolveAttendanceDay+saveAttendanceDay, buildXxxPenaltyResolver/buildUnifiedForgotOccurrenceMap từ
// modules/timesheet thay helpers/attendancePenalty.js).
describe("AttendanceController.importExcel", () => {
  test("import 1 ngày công bình thường: tạo work_unit đúng, đếm imported=1", async () => {
    const userId = new mongoose.Types.ObjectId();
    await UserInfoModel.create({
      full_name: "NV Test",
      cccd: "000000000001",
      phone_number: "0900000001",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: new mongoose.Types.ObjectId(),
      ma_nv: "NV001",
      employment_type: "fulltime"
    });
    await AttendanceMachineMappingModel.create({ machine_code: "M001", user_id: userId });
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    const buffer = buildExcelBuffer([
      {
        machineCode: "M001",
        days: [{ dateStr: "01/07/2026", inTime: "08:01", outTime: "17:31" }]
      }
    ]);

    const req = { file: { buffer } };
    const res = makeRes();
    await AttendanceController.importExcel(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ imported: 1, skipped: 0 }) })
    );
    const ws: any = await WorkSheetModel.findOne({ user_id: userId }).lean();
    expect(ws.work_unit).toBe(1);
    expect(ws.minutes_late).toBe(1);
  });

  test("mã máy chấm công không map với nhân viên nào: liệt vào unmatched_codes", async () => {
    // Cần ít nhất 1 mapping hợp lệ tồn tại (khác mã) để qua được guard "chưa cấu hình mapping nào".
    await AttendanceMachineMappingModel.create({
      machine_code: "SOME_OTHER",
      user_id: new mongoose.Types.ObjectId()
    });
    const buffer = buildExcelBuffer([
      {
        machineCode: "UNKNOWN",
        days: [{ dateStr: "01/07/2026", inTime: "08:01", outTime: "17:31" }]
      }
    ]);
    const req = { file: { buffer } };
    const res = makeRes();
    await AttendanceController.importExcel(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unmatched_codes: ["UNKNOWN"] }) })
    );
  });

  test("ngày không có worksheet cho nhân viên đó: tính vào skipped, không lỗi", async () => {
    const userId = new mongoose.Types.ObjectId();
    await UserInfoModel.create({
      full_name: "NV Test 2",
      cccd: "000000000002",
      phone_number: "0900000002",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: new mongoose.Types.ObjectId(),
      ma_nv: "NV002",
      employment_type: "fulltime"
    });
    await AttendanceMachineMappingModel.create({ machine_code: "M002", user_id: userId });
    // KHÔNG tạo worksheet cho ngày này -> resolveAttendanceDay skip vì !worksheet

    const buffer = buildExcelBuffer([
      { machineCode: "M002", days: [{ dateStr: "01/07/2026", inTime: "08:01", outTime: "17:31" }] }
    ]);
    const req = { file: { buffer } };
    const res = makeRes();
    await AttendanceController.importExcel(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ imported: 0, skipped: 1 }) })
    );
  });

  test("chạy import 2 lần với dữ liệu giống hệt: lần 2 tính vào unchanged", async () => {
    const userId = new mongoose.Types.ObjectId();
    await UserInfoModel.create({
      full_name: "NV Test 3",
      cccd: "000000000003",
      phone_number: "0900000003",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: new mongoose.Types.ObjectId(),
      ma_nv: "NV003",
      employment_type: "fulltime"
    });
    await AttendanceMachineMappingModel.create({ machine_code: "M003", user_id: userId });
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    const buffer = buildExcelBuffer([
      { machineCode: "M003", days: [{ dateStr: "01/07/2026", inTime: "08:01", outTime: "17:31" }] }
    ]);

    await AttendanceController.importExcel({ file: { buffer } }, makeRes());
    const res2 = makeRes();
    await AttendanceController.importExcel({ file: { buffer } }, res2);

    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ imported: 0, unchanged: 1 }) })
    );
  });
});

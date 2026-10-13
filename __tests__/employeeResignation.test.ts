import mongoose from "mongoose";
import moment from "moment-timezone";
import ExcelJS from "exceljs";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import { createDailyWorkSheets } from "../src/jobs/genWorkSheet";
import UserInfoModel from "../src/models/UserInfoModel";
import HolidayModel from "../src/models/HolidayModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import DepartmentModel from "../src/models/DepartmentModel";
import PositionModel from "../src/models/PositionModel";
import ShiftModel from "../src/models/ShiftModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import { buildAbility } from "../src/modules/permission";
import {
  isResignedAt,
  parseResignationDate,
  stillEmployedAtFilter
} from "../src/shared-kernel/resignation";

// UserController đọc thư mục upload ngay khi được nạp
process.env.UPLOAD_DIR_PUBLIC_DEV = process.env.UPLOAD_DIR_PUBLIC_DEV || "./uploads";
process.env.UPLOAD_DIR_DEV = process.env.UPLOAD_DIR_DEV || "./uploads";
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const UserController = require("../src/controllers/UserController");

const TZ = "Asia/Ho_Chi_Minh";
const day = (value: string) => moment.tz(value, TZ).startOf("day").toDate();
const endOfDay = (value: string) => moment.tz(value, TZ).endOf("day").toDate();

let mongod: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    UserInfoModel.deleteMany({}),
    HolidayModel.deleteMany({}),
    WorkSheetModel.deleteMany({}),
    WorkDayStatusModel.deleteMany({}),
    DepartmentModel.deleteMany({}),
    PositionModel.deleteMany({}),
    ShiftModel.deleteMany({}),
    UserDepartmentPositionModel.deleteMany({})
  ]);
});

function makeRes() {
  const res: any = { headers: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn((name: string, value: string) => {
    res.headers[name] = value;
  });
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function createUser(fullName: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  const code = String(seq).padStart(4, "0");
  return UserInfoModel.create({
    full_name: fullName,
    cccd: `00119900${code}`,
    phone_number: `090000${code}`,
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: new mongoose.Types.ObjectId(),
    ma_nv: `NV${code}`,
    employment_type: "fulltime",
    ...extra
  });
}

async function addWorkDay(userId: mongoose.Types.ObjectId, date: string, workUnit = 1) {
  const ws = await WorkSheetModel.create({ user_id: userId, date: day(date), work_unit: workUnit });
  await WorkDayStatusModel.create({
    user_id: userId,
    worksheet_id: ws._id,
    date: day(date),
    period: "full",
    status: "present",
    sources: []
  });
}

describe("shared-kernel/resignation — ngày nghỉ việc = ngày làm việc cuối cùng", () => {
  test("lưu ở 23:59:59.999 giờ VN", () => {
    expect(parseResignationDate("2026-10-20")?.toISOString()).toBe("2026-10-20T16:59:59.999Z");
    expect(parseResignationDate("20/10/2026")).toBeNull();
    expect(parseResignationDate("2026-02-30")).toBeNull();
  });

  test("cả ngày làm cuối vẫn còn làm, sang hôm sau mới là đã nghỉ", () => {
    const user = { resignation_date: endOfDay("2026-10-20") };
    expect(isResignedAt(user, moment.tz("2026-10-20 17:00", TZ).toDate())).toBe(false);
    expect(isResignedAt(user, day("2026-10-21"))).toBe(true);
    expect(isResignedAt({ resignation_date: null }, new Date())).toBe(false);
  });

  test("stillEmployedAtFilter giữ người có ngày làm cuối = đúng ngày đang xét", async () => {
    const lastDayToday = await createUser("Làm tới 20/10", {
      resignation_date: endOfDay("2026-10-20")
    });
    await createUser("Đã nghỉ 19/10", { resignation_date: endOfDay("2026-10-19") });
    const active = await createUser("Đang làm");

    const ids = (
      await UserInfoModel.find(stillEmployedAtFilter(day("2026-10-20"))).distinct("_id")
    ).map(String);
    expect(ids.sort()).toEqual([String(lastDayToday._id), String(active._id)].sort());
  });
});

describe("PATCH /user/:id/resignation — UserController.setResignationDate", () => {
  const allCompany = buildAbility([{ action: "employee.resign", subject: "Employee" }]);
  const call = async (params: any, body: any, ability = allCompany) => {
    const res = makeRes();
    await UserController.setResignationDate({ params, body, permissionAbility: ability }, res);
    return res;
  };

  test("đánh dấu rồi huỷ nghỉ việc", async () => {
    const user = await createUser("Nhân viên A");

    let res = await call({ id: String(user._id) }, { resignation_date: "2026-10-20" });
    expect(res.status).not.toHaveBeenCalled();
    expect((await UserInfoModel.findById(user._id))!.resignation_date!.toISOString()).toBe(
      "2026-10-20T16:59:59.999Z"
    );

    res = await call({ id: String(user._id) }, { resignation_date: null });
    expect(res.json.mock.calls[0][0].message).toBe("Đã huỷ nghỉ việc");
    expect((await UserInfoModel.findById(user._id))!.resignation_date).toBeNull();
  });

  test("báo lỗi khi sai định dạng, thiếu ngày, hoặc nghỉ trước ngày vào làm", async () => {
    const user = await createUser("Nhân viên B", { start_date: day("2026-09-01") });
    const id = String(user._id);
    expect((await call({ id }, { resignation_date: "20/10/2026" })).status).toHaveBeenCalledWith(
      400
    );
    expect((await call({ id }, {})).status).toHaveBeenCalledWith(400);
    expect((await call({ id }, { resignation_date: "2026-08-31" })).status).toHaveBeenCalledWith(
      400
    );
    expect(
      (await call({ id: "abc" }, { resignation_date: "2026-10-20" })).status
    ).toHaveBeenCalledWith(400);
  });

  test("ngoài phạm vi dữ liệu → 403, không tồn tại → 404", async () => {
    const [deptA, deptB] = await DepartmentModel.create([
      { department_name: "Phòng A", department_code: "RESIGN-A" },
      { department_name: "Phòng B", department_code: "RESIGN-B" }
    ]);
    const position = await PositionModel.create({ position_name: "Chuyên viên" });
    const inA = await createUser("Thuộc phòng A");
    const inB = await createUser("Thuộc phòng B");
    await UserDepartmentPositionModel.create([
      { user: inA._id, department: deptA._id, position: position._id },
      { user: inB._id, department: deptB._id, position: position._id }
    ]);
    const deptAOnly = buildAbility([
      {
        action: "employee.resign",
        subject: "Employee",
        conditions: { departmentId: { $in: [String(deptA._id)] } }
      } as any
    ]);

    expect(
      (await call({ id: String(inA._id) }, { resignation_date: "2026-10-20" }, deptAOnly)).status
    ).not.toHaveBeenCalled();
    expect(
      (await call({ id: String(inB._id) }, { resignation_date: "2026-10-20" }, deptAOnly)).status
    ).toHaveBeenCalledWith(403);
    expect(
      (
        await call(
          { id: String(new mongoose.Types.ObjectId()) },
          { resignation_date: "2026-10-20" }
        )
      ).status
    ).toHaveBeenCalledWith(404);
  });
});

describe("Không cho chọn ngày làm việc cuối trước ngày đã có công", () => {
  const allCompany = buildAbility([{ action: "employee.resign", subject: "Employee" }]);
  const daysAgo = (n: number) => moment.tz(TZ).subtract(n, "day").format("YYYY-MM-DD");
  const daysLater = (n: number) => moment.tz(TZ).add(n, "day").format("YYYY-MM-DD");

  test("PATCH chặn ngày trước ngày có công gần nhất, công trong tương lai không tính", async () => {
    const user = await createUser("Còn công tháng này", { start_date: day(daysAgo(60)) });
    await WorkSheetModel.create([
      { user_id: user._id, date: day(daysAgo(20)), work_unit: 1 },
      // chỉ có giờ chấm vào, chưa chốt công → vẫn tính là đã đi làm
      { user_id: user._id, date: day(daysAgo(3)), work_unit: null, check_in: new Date() },
      { user_id: user._id, date: day(daysAgo(1)), work_unit: 0 }, // vắng → không tính
      { user_id: user._id, date: day(daysLater(5)), work_unit: 1 } // phép duyệt trước → không tính
    ]);

    const patch = async (date: string) => {
      const res = makeRes();
      await UserController.setResignationDate(
        {
          params: { id: String(user._id) },
          body: { resignation_date: date },
          permissionAbility: allCompany
        },
        res
      );
      return res;
    };

    const rejected = await patch(daysAgo(10));
    expect(rejected.status).toHaveBeenCalledWith(400);
    expect(rejected.json.mock.calls[0][0].message).toContain(
      moment.tz(daysAgo(3), TZ).format("DD/MM/YYYY")
    );
    expect((await patch(daysAgo(3))).status).not.toHaveBeenCalled();

    const res = makeRes();
    await UserController.getResignationInfo(
      { params: { id: String(user._id) }, permissionAbility: allCompany },
      res
    );
    expect(res.json.mock.calls[0][0].data).toEqual({
      resignation_date: daysAgo(3),
      start_date: daysAgo(60),
      last_work_date: daysAgo(3),
      min_resignation_date: daysAgo(3)
    });
  });

  test("chưa có công nào thì ngày sớm nhất là ngày vào làm", async () => {
    const user = await createUser("Mới vào", { start_date: day(daysAgo(2)) });
    const res = makeRes();
    await UserController.getResignationInfo(
      { params: { id: String(user._id) }, permissionAbility: allCompany },
      res
    );
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      last_work_date: null,
      min_resignation_date: daysAgo(2)
    });
  });
});

describe("GET /user/getUsers — lọc trạng thái làm việc", () => {
  const viewOnly = buildAbility([{ action: "employee.view", subject: "Employee" }]);
  const viewAndResign = buildAbility([
    { action: "employee.view", subject: "Employee" },
    { action: "employee.resign", subject: "Employee" }
  ]);
  const list = async (query: any, ability = viewOnly) => {
    const res = makeRes();
    await UserController.getUsers({ query, permissionAbility: ability }, res);
    return res.json.mock.calls[0][0].data as any[];
  };

  test("active / resigned / tất cả, và cờ can_resign theo quyền", async () => {
    const yesterday = moment.tz(TZ).subtract(1, "day").format("YYYY-MM-DD");
    const tomorrow = moment.tz(TZ).add(1, "day").format("YYYY-MM-DD");
    await createUser("Đang làm");
    await createUser("Làm tới mai", { resignation_date: parseResignationDate(tomorrow) });
    await createUser("Đã nghỉ", { resignation_date: parseResignationDate(yesterday) });

    const names = (rows: any[]) => rows.map((r) => r.full_name).sort();
    expect(names(await list({ work_status: "active" }))).toEqual(
      ["Làm tới mai", "Đang làm"].sort()
    );
    expect(names(await list({ work_status: "resigned" }))).toEqual(["Đã nghỉ"]);
    expect(await list({})).toHaveLength(3);

    expect((await list({}, viewOnly)).every((r) => r.can_resign === false)).toBe(true);
    expect((await list({}, viewAndResign)).every((r) => r.can_resign === true)).toBe(true);

    // Quyền riêng: chỉ có employee.set_status (đổi loại hợp đồng) thì không được đánh dấu nghỉ việc
    const setStatusOnly = buildAbility([
      { action: "employee.view", subject: "Employee" },
      { action: "employee.set_status", subject: "Employee" }
    ]);
    expect((await list({}, setStatusOnly)).every((r) => r.can_resign === false)).toBe(true);
  });
});

describe("Cron genWorkSheet — dừng tạo bảng công sau ngày làm cuối", () => {
  test("ngày làm cuối vẫn tạo, đã nghỉ thì không", async () => {
    await ShiftModel.create([
      { name: "Ca hành chính", start_time: "08:00", end_time: "17:00" },
      { name: "Ca sáng", start_time: "08:00", end_time: "12:00" }
    ]);
    const lastDayToday = await createUser("Làm cuối 20/10", {
      resignation_date: endOfDay("2026-10-20")
    });
    const resigned = await createUser("Nghỉ từ 19/10", {
      resignation_date: endOfDay("2026-10-19")
    });
    const active = await createUser("Đang làm");

    await createDailyWorkSheets(moment.tz("2026-10-20 00:01", TZ).toDate()); // thứ 3

    const userIds = (
      await WorkSheetModel.find({ date: day("2026-10-20") }).distinct("user_id")
    ).map(String);
    expect(userIds.sort()).toEqual([String(lastDayToday._id), String(active._id)].sort());
    expect(userIds).not.toContain(String(resigned._id));
  });
});

describe("Bảng công & xuất Excel — nhân sự nghỉ việc", () => {
  const payrollAll = buildAbility([{ action: "payroll.view", subject: "Payroll" }]);

  async function payrollRows() {
    const res = makeRes();
    await AttendanceController.getPayrollStatsAll(
      { query: { month: "6", year: "2026" }, permissionAbility: payrollAll },
      res
    );
    return res.json.mock.calls[0][0].data as any[];
  }

  test("giữ người nghỉ giữa kỳ có công, bỏ người nghỉ trước kỳ hoặc nghỉ trong kỳ không có công", async () => {
    const dept = await DepartmentModel.create({
      department_name: "Khối test",
      department_code: "RESIGN-P"
    });
    const [specialist, ctvPosition] = await PositionModel.create([
      { position_name: "Chuyên viên" },
      { position_name: "CTV" }
    ]);

    // Kỳ 6/2026: 26/05 → 25/06
    const midPeriod = await createUser("Nghỉ giữa kỳ", {
      resignation_date: endOfDay("2026-06-03")
    });
    await addWorkDay(midPeriod._id, "2026-06-02");
    await addWorkDay(midPeriod._id, "2026-06-03");
    await addWorkDay(midPeriod._id, "2026-06-04", 0); // worksheet lỡ tạo sau ngày nghỉ → bỏ qua
    await createUser("Nghỉ trước kỳ", { resignation_date: endOfDay("2026-05-20") });
    await createUser("Nghỉ trong kỳ, không công", { resignation_date: endOfDay("2026-06-01") });
    const lastDayIsPeriodStart = await createUser("Làm cuối 26/05", {
      resignation_date: endOfDay("2026-05-26")
    });
    await addWorkDay(lastDayIsPeriodStart._id, "2026-05-26");
    const ctv = await createUser("CTV nghỉ trong kỳ", { resignation_date: endOfDay("2026-06-01") });
    await UserDepartmentPositionModel.create([
      { user: midPeriod._id, department: dept._id, position: specialist._id },
      { user: ctv._id, department: dept._id, position: ctvPosition._id }
    ]);
    await createUser("Đang làm");
    // Ngày lễ có lương SAU ngày nghỉ → không được cộng công
    await HolidayModel.create({
      date: day("2026-06-10"),
      name: "Lễ test",
      year: 2026,
      duration_days: 1,
      scope_type: "all",
      pay_policy: "paid"
    });

    const rows = await payrollRows();
    expect(rows.map((r) => r.full_name).sort()).toEqual(
      ["CTV nghỉ trong kỳ", "Làm cuối 26/05", "Nghỉ giữa kỳ", "Đang làm"].sort()
    );
    const mid = rows.find((r) => r.full_name === "Nghỉ giữa kỳ");
    expect(mid.work_unit_total).toBe(2);
    expect(mid.resignation_date).toBe("03/06/2026");
    expect(rows.find((r) => r.full_name === "Làm cuối 26/05").work_unit_total).toBe(1);
    // Người đang làm vẫn được cộng công ngày lễ như cũ
    expect(rows.find((r) => r.full_name === "Đang làm").work_unit_total).toBe(1);

    const res = makeRes();
    await AttendanceController.exportPayrollTimesheet(
      { query: { month: "6", year: "2026" }, permissionAbility: payrollAll },
      res
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.send.mock.calls[0][0]);
    const sheet = workbook.getWorksheet("Tổng công")!;
    const exportedNames: string[] = [];
    let midRow: ExcelJS.Row | undefined;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 12 || typeof row.getCell(1).value !== "number") return;
      exportedNames.push(String(row.getCell(2).value));
      if (row.getCell(2).value === "Nghỉ giữa kỳ") midRow = row;
    });
    expect(exportedNames.sort()).toEqual(rows.map((r) => r.full_name).sort());

    const dayCol = (date: string) =>
      5 + moment.tz(date, TZ).diff(moment.tz("2026-05-26", TZ), "days");
    expect(midRow!.getCell(dayCol("2026-06-03")).value).toBe("X");
    expect(midRow!.getCell(dayCol("2026-06-04")).value).toBeNull(); // sau ngày nghỉ: trống, không K
    expect(midRow!.getCell(dayCol("2026-06-10")).value).toBeNull(); // lễ sau ngày nghỉ: trống, không L
  });
});

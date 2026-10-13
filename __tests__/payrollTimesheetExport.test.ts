import mongoose from "mongoose";
import moment from "moment-timezone";
import ExcelJS from "exceljs";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import UserInfoModel from "../src/models/UserInfoModel";
import HolidayModel from "../src/models/HolidayModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import DepartmentModel from "../src/models/DepartmentModel";
import PositionModel from "../src/models/PositionModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import { buildAbility } from "../src/modules/permission";
import { resolveDayCode, isFixedCtv } from "../src/helpers/timesheetExcel";

const TZ = "Asia/Ho_Chi_Minh";
const day = (value: string) => moment.tz(value, TZ).startOf("day").toDate();
const allCompanyPayrollAbility = buildAbility([{ action: "payroll.view", subject: "Payroll" }]);

describe("resolveDayCode", () => {
  const status = (value: string, period = "full") => ({ status: value, period });

  test.each([
    ["đi làm đủ ngày", { work_unit: 1, statuses: [status("present")] }, "X"],
    ["thứ 7 làm nửa ngày", { work_unit: 0.5, statuses: [status("present")] }, "V"],
    [
      "nửa ngày làm + nửa ngày nghỉ phép",
      { work_unit: 1, statuses: [status("present", "morning"), status("leave_paid", "afternoon")] },
      "H"
    ],
    ["nghỉ phép cả ngày", { work_unit: 1, statuses: [status("leave_paid")] }, "P"],
    ["nghỉ không lương", { work_unit: 0, statuses: [status("leave_unpaid")] }, "K"],
    ["vắng không phép", { work_unit: 0, statuses: [status("absent")] }, "K"],
    ["remote", { work_unit: 1, statuses: [status("remote")] }, "R"],
    ["đi công tác", { work_unit: 1, statuses: [status("business_trip")] }, "X"],
    ["gặp khách hàng", { work_unit: 1, statuses: [status("client_visit")] }, "X"],
    ["quên chấm, chỉ được nửa công", { work_unit: 0.5, statuses: [status("missed_clock")] }, "V"],
    ["ngày lễ không đi làm", { work_unit: 1, statuses: [], is_holiday: true }, "L"],
    ["1,5 công", { work_unit: 1.5, statuses: [] }, "A"],
    ["chưa chốt công trong ngày", { work_unit: null, statuses: [status("present")] }, ""],
    ["ngày chưa tới", { work_unit: null, statuses: [status("pending")] }, ""],
    ["Chủ nhật / không có lịch", { work_unit: null, statuses: [] }, ""]
  ])("%s → %s", (_label, input, expected) => {
    expect(resolveDayCode({ is_holiday: false, ...input } as any)).toBe(expected);
  });
});

describe("isFixedCtv", () => {
  test("chỉ chức vụ đúng chữ CTV mới cố định công", () => {
    expect(isFixedCtv(["CTV"])).toBe(true);
    expect(isFixedCtv([" ctv "])).toBe(true);
    expect(isFixedCtv(["CTV CSKH"])).toBe(false);
    expect(isFixedCtv(["CTV", "Chuyên viên"])).toBe(false);
    expect(isFixedCtv([])).toBe(false);
  });
});

describe("AttendanceController.exportPayrollTimesheet", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
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

  function userInfo(maNv: string, fullName: string) {
    return {
      full_name: fullName,
      cccd: `0011990${maNv}`,
      phone_number: `09000${maNv}`,
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: new mongoose.Types.ObjectId(),
      ma_nv: maNv,
      employment_type: "fulltime"
    };
  }

  async function addDay(
    userId: mongoose.Types.ObjectId,
    date: string,
    workUnit: number,
    statuses: Array<{ status: string; period?: string }>,
    extra: Record<string, unknown> = {}
  ) {
    const ws = await WorkSheetModel.create({
      user_id: userId,
      date: day(date),
      work_unit: workUnit,
      ...extra
    });
    await WorkDayStatusModel.create(
      statuses.map(({ status, period = "full" }) => ({
        user_id: userId,
        worksheet_id: ws._id,
        date: day(date),
        period,
        status,
        sources: []
      }))
    );
  }

  test("xuất đúng bố cục mẫu Tổng công: ký hiệu từng ngày, tổng công, CTV cố định 12 công", async () => {
    const dept = await DepartmentModel.create({
      department_name: "Khối công nghệ",
      department_code: "KCN-EXPORT-TEST"
    });
    const [specialist, ctv] = await PositionModel.create([
      { position_name: "Chuyên viên" },
      { position_name: "CTV" }
    ]);
    const [staff, collaborator] = await UserInfoModel.create([
      userInfo("NV001", "Nhân viên A"),
      userInfo("NV002", "Cộng tác viên B")
    ]);
    await UserDepartmentPositionModel.create([
      { user: staff._id, department: dept._id, position: specialist._id },
      { user: collaborator._id, department: dept._id, position: ctv._id }
    ]);

    await addDay(staff._id, "2026-05-26", 1, [{ status: "present" }], { penalty_amount: 50000 });
    await addDay(staff._id, "2026-05-30", 0.5, [{ status: "present" }]);
    await addDay(staff._id, "2026-06-01", 1, [{ status: "leave_paid" }]);
    await HolidayModel.create({
      date: day("2026-06-10"),
      name: "Ngày lễ test",
      year: 2026,
      duration_days: 1,
      scope_type: "all",
      pay_policy: "paid"
    });

    const res = makeRes();
    await AttendanceController.exportPayrollTimesheet(
      {
        query: { month: "6", year: "2026" },
        account: { _id: new mongoose.Types.ObjectId() },
        permissionAbility: allCompanyPayrollAbility
      },
      res
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.headers["Content-Disposition"]).toContain("bang-cong-T06-2026.xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.send.mock.calls[0][0]);
    const sheet = workbook.getWorksheet("Tổng công")!;
    const text = (address: string) => sheet.getCell(address).value;

    expect(text("B2")).toBe("BẢNG CHẤM CÔNG THÁNG 06/2026");
    expect(text("C3")).toBe("26/05/2026");
    expect(text("D3")).toBe("Đến ngày: 25/06/2026");
    expect(text("A10")).toBe("TT");
    expect(text("E10")).toBe("Ngày công trong tháng");
    expect(text("E11")).toBe("26");
    expect(text("E12")).toBe("T3");

    // Kỳ 26/05 → 25/06 có 31 ngày: cột ngày E..AI, tổng công bắt đầu từ cột AJ (36)
    const dayCol = (date: string) =>
      5 + moment.tz(date, TZ).diff(moment.tz("2026-05-26", TZ), "days");
    const staffRow = sheet.getRow(13);
    expect(staffRow.getCell(2).value).toBe("Nhân viên A");
    expect(staffRow.getCell(3).value).toBe("Khối công nghệ");
    expect(staffRow.getCell(4).value).toBe("Chuyên viên");
    expect(staffRow.getCell(dayCol("2026-05-26")).value).toBe("X");
    expect(staffRow.getCell(dayCol("2026-05-30")).value).toBe("V");
    expect(staffRow.getCell(dayCol("2026-05-31")).value).toBeNull();
    expect(staffRow.getCell(dayCol("2026-06-01")).value).toBe("P");
    expect(staffRow.getCell(dayCol("2026-06-10")).value).toBe("L");

    const totals = (row: ExcelJS.Row) =>
      [36, 37, 38, 39, 40, 41, 42].map((c) => row.getCell(c).value);
    // Tổng = 1 + 0,5 + 1 (phép) + 1 (lễ); thực tế = tổng − nghỉ phép; phạt 50.000; không quên chấm
    expect(totals(staffRow)).toEqual([3.5, 2.5, 3.5, null, 1, 50000, null]);

    const ctvRow = sheet.getRow(14);
    expect(ctvRow.getCell(2).value).toBe("Cộng tác viên B");
    expect(ctvRow.getCell(dayCol("2026-05-26")).value).toBeNull();
    expect(totals(ctvRow)).toEqual([12, 0, 12, null, 0, null, null]);
  });

  test("thiếu month/year trả 400", async () => {
    const res = makeRes();
    await AttendanceController.exportPayrollTimesheet(
      { query: {}, permissionAbility: allCompanyPayrollAbility },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

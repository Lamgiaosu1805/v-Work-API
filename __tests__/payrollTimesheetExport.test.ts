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
import LeaveBalanceModel from "../src/models/LeaveBalanceModel";
import EmploymentStatusModel from "../src/models/EmploymentStatusModel";
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
    [
      "nghỉ phép thứ 7",
      { work_unit: 0.5, statuses: [status("leave_paid")], dateKey: "2026-10-17" },
      "P/2"
    ],
    [
      "thứ 7 vừa đi làm vừa có trạng thái nghỉ phép",
      {
        work_unit: 0.5,
        statuses: [status("present"), status("leave_paid")],
        dateKey: "2026-10-17"
      },
      "H"
    ],
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
  ])("%s → %s", (_label, { dateKey, ...input }: any, expected) => {
    expect(resolveDayCode({ is_holiday: false, ...input }, dateKey)).toBe(expected);
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

  test("xuất đúng bố cục mẫu Tổng công: ký hiệu từng ngày, tổng công, CTV cố định 12 công, phép tồn, ngày thử việc/chính thức", async () => {
    const dept = await DepartmentModel.create({
      department_name: "Khối công nghệ",
      department_code: "KCN-EXPORT-TEST"
    });
    const [specialist, ctv] = await PositionModel.create([
      { position_name: "Chuyên viên" },
      { position_name: "CTV" }
    ]);
    const [staff, collaborator] = await UserInfoModel.create([
      {
        ...userInfo("NV001", "Nhân viên A"),
        start_date: day("2026-04-01"),
        probation_end_date: day("2026-06-05")
      },
      // Không có ngày hết thử việc = vào làm chính thức luôn → ngày chính thức = ngày vào làm
      { ...userInfo("NV002", "Cộng tác viên B"), start_date: day("2026-03-15") }
    ]);
    // Đang thử việc nhưng hồ sơ chưa có ngày vào làm / ngày hết thử việc → tô vàng để HR bổ sung
    const probationStatus = await EmploymentStatusModel.create({
      code: "probation",
      name: "Thử việc"
    });
    const missingDates = await UserInfoModel.create({
      ...userInfo("NV003", "Thử việc thiếu ngày"),
      employment_status: probationStatus._id,
      // Đang thử việc → ngày chính thức chỉ là dự kiến
      probation_end_date: day("2026-07-31")
    });
    // Đang hợp đồng Thử việc, chưa có ngày hết thử việc → toàn bộ công tạm tính thử việc, dòng tô vàng
    const probationNoEnd = await UserInfoModel.create({
      ...userInfo("NV004", "Thử việc chưa có ngày hết"),
      employment_status: probationStatus._id,
      start_date: day("2026-05-04")
    });
    // Sổ phép ghi thẳng collection để giữ createdAt (mongoose timestamps sẽ ghi đè). Phép tồn chỉ lấy
    // bút toán KHÔNG gắn đơn ghi trước kỳ (26/05); phần đã nghỉ lấy theo ngày nghỉ thật trước kỳ — bút
    // toán trừ/hoàn theo đơn ghi lúc gửi đơn nên bị bỏ qua.
    const ledger = (amount: number, reason: string, createdAt: string, isDeleted = false) => ({
      user_id: staff._id,
      amount,
      reason,
      isDeleted,
      createdAt: day(createdAt)
    });
    await LeaveBalanceModel.collection.insertMany([
      ledger(1, "monthly_accrual", "2026-04-01"),
      ledger(1, "monthly_accrual", "2026-05-01"),
      ledger(1.5, "hr_manual_adjustment", "2026-05-10"),
      ledger(5, "hr_manual_adjustment", "2026-05-11", true),
      // Trong kỳ → không vào phép tồn
      ledger(1, "monthly_accrual", "2026-06-01"),
      // Nghỉ sáng 15/05 và thứ 7 16/05 (chỉ trừ 0,5) — đơn gửi trước khi nghỉ
      ledger(-0.5, "leave_request_deduction", "2026-05-14"),
      ledger(-0.5, "leave_request_deduction", "2026-05-14"),
      // Đăng ký trước cho ngày 01/06 (trong kỳ) → không trừ vào phép tồn, chỉ hiện ở cột Nghỉ phép
      ledger(-1, "leave_request_deduction", "2026-05-20"),
      // Đơn chờ duyệt: đã trừ sổ nhưng chưa nghỉ → không trừ
      ledger(-2.5, "leave_request_deduction", "2026-05-22"),
      // Gửi bù sau kỳ cho ngày nghỉ 25/05 → vẫn trừ vào phép tồn theo ngày nghỉ
      ledger(-1, "leave_request_deduction", "2026-05-27")
    ]);
    await addDay(staff._id, "2026-05-15", 0.5, [
      { status: "present", period: "afternoon" },
      { status: "leave_paid", period: "morning" }
    ]);
    await addDay(staff._id, "2026-05-16", 0.5, [{ status: "leave_paid" }]);
    await addDay(staff._id, "2026-05-25", 1, [{ status: "leave_paid" }]);
    await UserDepartmentPositionModel.create([
      { user: staff._id, department: dept._id, position: specialist._id },
      { user: collaborator._id, department: dept._id, position: ctv._id },
      { user: missingDates._id, department: dept._id, position: specialist._id },
      { user: probationNoEnd._id, department: dept._id, position: specialist._id }
    ]);

    await addDay(staff._id, "2026-05-26", 1, [{ status: "present" }], { penalty_amount: 50000 });
    await addDay(staff._id, "2026-05-30", 0.5, [{ status: "present" }]);
    await addDay(staff._id, "2026-06-01", 1, [{ status: "leave_paid" }]);
    // Ngày hết thử việc (05/06) vẫn tính công thử việc
    await addDay(staff._id, "2026-06-05", 1, [{ status: "present" }]);
    await addDay(probationNoEnd._id, "2026-06-02", 1, [{ status: "present" }]);
    await addDay(probationNoEnd._id, "2026-06-03", 1, [{ status: "present" }]);
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
    expect(text("F10")).toBe("Ngày công trong tháng");
    expect(text("F11")).toBe("26");
    expect(text("F12")).toBe("T3");

    expect(text("B10")).toBe("Mã NV");
    // Kỳ 26/05 → 25/06 có 31 ngày: cột ngày F..AJ, tổng công bắt đầu từ cột AK (37)
    const dayCol = (date: string) =>
      6 + moment.tz(date, TZ).diff(moment.tz("2026-05-26", TZ), "days");
    const staffRow = sheet.getRow(13);
    expect(staffRow.getCell(2).value).toBe("NV001");
    expect(staffRow.getCell(3).value).toBe("Nhân viên A");
    expect(staffRow.getCell(4).value).toBe("Khối công nghệ");
    expect(staffRow.getCell(5).value).toBe("Chuyên viên");
    expect(staffRow.getCell(dayCol("2026-05-26")).value).toBe("X");
    expect(staffRow.getCell(dayCol("2026-05-30")).value).toBe("V");
    expect(staffRow.getCell(dayCol("2026-05-31")).value).toBeNull();
    expect(staffRow.getCell(dayCol("2026-06-01")).value).toBe("P");
    expect(staffRow.getCell(dayCol("2026-06-10")).value).toBe("L");

    const totals = (row: ExcelJS.Row) =>
      [37, 38, 39, 40, 41, 42, 43, 44, 45, 46].map((c) => row.getCell(c).value);
    expect(text("AO11")).toBe("Phép tồn tháng trước");
    expect(text("AS10")).toBe("Ngày thử việc");
    expect(text("AT10")).toBe("Ngày chính thức");
    // Tổng = 1 + 0,5 + 1 (phép) + 1 (05/06) + 1 (lễ); đến hết 05/06 là thử việc (3,5), sau đó (lễ
    // 10/06) là chính thức; phép tồn = (1 + 1 + 1,5) − (0,5 + 0,5 + 1) = 1,5; phạt 50.000
    expect(totals(staffRow)).toEqual([
      4.5,
      3.5,
      1,
      3.5,
      1.5,
      1,
      50000,
      null,
      "01/04/2026",
      "06/06/2026"
    ]);

    const ctvRow = sheet.getRow(14);
    expect(ctvRow.getCell(3).value).toBe("Cộng tác viên B");
    expect(ctvRow.getCell(dayCol("2026-05-26")).value).toBeNull();
    expect(totals(ctvRow)).toEqual([12, 0, 12, null, 0, 0, null, null, null, "15/03/2026"]);

    const fillOf = (row: ExcelJS.Row, col: number) =>
      (row.getCell(col).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
    expect(String(text("B7"))).toContain("thiếu ngày vào làm");
    const missingRow = sheet.getRow(15);
    expect(missingRow.getCell(3).value).toBe("Thử việc thiếu ngày");
    expect(fillOf(missingRow, 3)).toBe("FFFFF2CC");
    expect(missingRow.getCell(45).value).toBeNull();
    expect(missingRow.getCell(46).value).toBe("01/08/2026 (dự kiến)");
    expect(fillOf(missingRow, 46)).toBe("FFFFF2CC");
    expect(fillOf(staffRow, 3)).toBeUndefined();

    // Thử việc chưa có ngày hết thử việc: 2 công đều là công thử việc, chưa biết ngày chính thức
    const probationNoEndRow = sheet.getRow(16);
    expect(probationNoEndRow.getCell(3).value).toBe("Thử việc chưa có ngày hết");
    expect(totals(probationNoEndRow).slice(0, 3)).toEqual([3, 3, 0]);
    expect(probationNoEndRow.getCell(45).value).toBe("04/05/2026");
    expect(probationNoEndRow.getCell(46).value).toBeNull();
    expect(fillOf(probationNoEndRow, 3)).toBe("FFFFF2CC");
    // CTV không cần ngày thử việc/chính thức → không tô dù hồ sơ trống
    expect(fillOf(ctvRow, 3)).toBeUndefined();
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

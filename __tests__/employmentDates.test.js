process.env.UPLOAD_DIR_PUBLIC_DEV = process.env.UPLOAD_DIR_PUBLIC_DEV || "./uploads";
process.env.UPLOAD_DIR_DEV = process.env.UPLOAD_DIR_DEV || "./uploads";

const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const UserController = require("../src/controllers/UserController");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const EmploymentStatusModel = require("../src/models/EmploymentStatusModel");
const LeaveBalanceModel = require("../src/models/LeaveBalanceModel");
const PositionModel = require("../src/models/PositionModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const { buildAbility } = require("../src/modules/permission");
const redisMock = require("./mocks/redis");

// Ngày vào làm (start_date) và ngày hết thử việc (probation_end_date = ngày thử việc cuối cùng):
// HR nhập trên form nhân viên, hoặc hệ thống tự đặt khi đổi loại hợp đồng sang Chính thức.

const TZ = "Asia/Ho_Chi_Minh";
const dateKey = (date) => (date ? moment.tz(date, TZ).format("YYYY-MM-DD") : null);

let mongod;
let probationStatus;
let officialStatus;
let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
  [probationStatus, officialStatus] = await EmploymentStatusModel.create([
    { code: "probation", name: "Thử việc" },
    { code: "official", name: "Chính thức", accrues_annual_leave: true }
  ]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    LeaveBalanceModel.deleteMany({})
  ]);
  redisMock.__store.clear();
});

async function createEmployee(extra = {}) {
  seq += 1;
  const account = await AccountModel.create({ username: `u${seq}`, password: "x", role: "user" });
  return UserInfoModel.create({
    full_name: `Nhân viên ${seq}`,
    cccd: `${seq}`.padStart(12, "0"),
    phone_number: `090${seq}`.padEnd(10, "0"),
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `NV${seq}`,
    employment_type: "fulltime",
    ...extra
  });
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function updateUser(id, body) {
  const res = makeRes();
  await UserController.updateUser(
    {
      params: { id: String(id) },
      body,
      account: { _id: new mongoose.Types.ObjectId(), role: "admin" }
    },
    res
  );
  return res;
}

async function setEmploymentStatus(id, statusId, effectiveDate) {
  const res = makeRes();
  await UserController.setEmploymentStatus(
    {
      params: { id: String(id) },
      body: { employment_status_id: String(statusId), effective_date: effectiveDate }
    },
    res
  );
  return res;
}

describe("updateUser — ngày vào làm / ngày hết thử việc", () => {
  test("lưu theo ngày giờ VN, chuỗi rỗng là xoá ngày", async () => {
    const employee = await createEmployee();

    let res = await updateUser(employee._id, {
      start_date: "2026-08-01",
      probation_end_date: "2026-09-30"
    });
    expect(res.status).toHaveBeenCalledWith(200);
    let saved = await UserInfoModel.findById(employee._id);
    expect(dateKey(saved.start_date)).toBe("2026-08-01");
    expect(dateKey(saved.probation_end_date)).toBe("2026-09-30");

    res = await updateUser(employee._id, { probation_end_date: "" });
    expect(res.status).toHaveBeenCalledWith(200);
    saved = await UserInfoModel.findById(employee._id);
    expect(dateKey(saved.start_date)).toBe("2026-08-01");
    expect(saved.probation_end_date).toBeNull();
  });

  test("ngày hết thử việc trước ngày vào làm (kể cả ngày đang lưu) → 400", async () => {
    const employee = await createEmployee({ start_date: new Date("2026-08-01T00:00:00+07:00") });

    const res = await updateUser(employee._id, { probation_end_date: "2026-07-31" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toContain("01/08/2026");
    const saved = await UserInfoModel.findById(employee._id);
    expect(saved.probation_end_date).toBeNull();
  });

  describe("đã có ngày chính thức → ngày hết thử việc bị khoá", () => {
    const lockedEmployee = () =>
      createEmployee({
        start_date: new Date("2026-10-29T00:00:00+07:00"),
        official_date: new Date("2026-10-29T00:00:00+07:00"),
        employment_status: officialStatus._id
      });

    test("gửi ngày hết thử việc lệch ngày chính thức → 400 (trường hợp 29/10 nhập 31/10)", async () => {
      const employee = await lockedEmployee();
      const res = await updateUser(employee._id, {
        start_date: "2026-10-29",
        probation_end_date: "2026-10-31"
      });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toContain("Chính thức từ 29/10/2026");
      const saved = await UserInfoModel.findById(employee._id);
      expect(saved.probation_end_date).toBeNull();
    });

    test("gửi đúng giá trị khoá → lưu bình thường", async () => {
      const employee = await lockedEmployee();
      const res = await updateUser(employee._id, {
        start_date: "2026-10-29",
        probation_end_date: "",
        full_name: "Đổi tên"
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("sửa ngày vào làm sớm hơn → ngày hết thử việc tự tính lại theo ngày chính thức", async () => {
      const employee = await lockedEmployee();
      const res = await updateUser(employee._id, { start_date: "2026-09-01" });
      expect(res.status).toHaveBeenCalledWith(200);
      const saved = await UserInfoModel.findById(employee._id);
      expect(dateKey(saved.start_date)).toBe("2026-09-01");
      expect(dateKey(saved.probation_end_date)).toBe("2026-10-28");
    });

    test("ngày vào làm sau ngày chính thức → 400", async () => {
      const employee = await lockedEmployee();
      const res = await updateUser(employee._id, { start_date: "2026-11-01" });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toContain("29/10/2026");
    });
  });

  test("sai định dạng → 400", async () => {
    const employee = await createEmployee();
    const res = await updateUser(employee._id, { start_date: "01/08/2026" });
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("setEmploymentStatus — tự đặt ngày hết thử việc khi lên chính thức", () => {
  test("thử việc → chính thức: ngày hết thử việc = ngày liền trước ngày hiệu lực", async () => {
    const employee = await createEmployee({
      start_date: new Date("2026-08-01T00:00:00+07:00"),
      probation_end_date: new Date("2026-09-15T00:00:00+07:00"),
      employment_status: probationStatus._id
    });

    const res = await setEmploymentStatus(employee._id, officialStatus._id, "2026-10-01");
    expect(res.status).not.toHaveBeenCalled();
    const saved = await UserInfoModel.findById(employee._id);
    expect(saved.employment_status.toString()).toBe(officialStatus._id.toString());
    // Lưu ngày chính thức, ghi đè ngày hết thử việc dự kiến theo ngày chính thức thật
    expect(dateKey(saved.official_date)).toBe("2026-10-01");
    expect(dateKey(saved.probation_end_date)).toBe("2026-09-30");
  });

  test("ngày hiệu lực trùng ngày vào làm → không có thử việc", async () => {
    const employee = await createEmployee({ start_date: new Date("2026-08-01T00:00:00+07:00") });
    await setEmploymentStatus(employee._id, officialStatus._id, "2026-08-01");
    const saved = await UserInfoModel.findById(employee._id);
    expect(saved.probation_end_date).toBeNull();
  });

  test.each([
    ["chính thức", () => officialStatus],
    ["thử việc", () => probationStatus]
  ])("chưa có ngày vào làm → không cho đổi sang %s (400), không đổi gì", async (_label, status) => {
    const employee = await createEmployee();

    const res = await setEmploymentStatus(employee._id, status()._id, "2026-10-28");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe(
      "Cần nhập ngày vào làm trước khi đổi loại hợp đồng"
    );
    const saved = await UserInfoModel.findById(employee._id);
    expect(saved.employment_status).toBeNull();
    expect(saved.probation_end_date).toBeNull();
  });

  test("chọn lại Chính thức với đúng ngày chính thức đang lưu → 400, không đổi gì", async () => {
    const employee = await createEmployee({
      start_date: new Date("2026-08-01T00:00:00+07:00"),
      official_date: new Date("2026-10-01T00:00:00+07:00"),
      probation_end_date: new Date("2026-09-30T00:00:00+07:00"),
      employment_status: officialStatus._id
    });
    const res = await setEmploymentStatus(employee._id, officialStatus._id, "2026-10-01");
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("sửa ngày chính thức (chọn lại Chính thức, ngày khác) → cập nhật ngày, không cộng bù phép", async () => {
    const employee = await createEmployee({
      start_date: new Date("2026-08-01T00:00:00+07:00"),
      official_date: new Date("2026-10-01T00:00:00+07:00"),
      probation_end_date: new Date("2026-09-30T00:00:00+07:00"),
      employment_status: officialStatus._id
    });
    const res = await setEmploymentStatus(employee._id, officialStatus._id, "2026-10-15");
    expect(res.status).not.toHaveBeenCalled();
    const saved = await UserInfoModel.findById(employee._id);
    expect(dateKey(saved.official_date)).toBe("2026-10-15");
    expect(dateKey(saved.probation_end_date)).toBe("2026-10-14");
    expect(await LeaveBalanceModel.countDocuments({ user_id: employee._id })).toBe(0);
  });

  test("dữ liệu cũ đã Chính thức, chọn lại Chính thức kèm ngày → ghi nhận ngày chính thức", async () => {
    const employee = await createEmployee({
      start_date: new Date("2026-03-01T00:00:00+07:00"),
      employment_status: officialStatus._id
    });
    await setEmploymentStatus(employee._id, officialStatus._id, "2026-05-01");
    const saved = await UserInfoModel.findById(employee._id);
    expect(dateKey(saved.official_date)).toBe("2026-05-01");
    expect(dateKey(saved.probation_end_date)).toBe("2026-04-30");
    expect(await LeaveBalanceModel.countDocuments({ user_id: employee._id })).toBe(0);
  });

  test.each([
    ["có ngày chính thức", { official_date: new Date("2026-10-01T00:00:00+07:00") }],
    ["dữ liệu cũ chưa có ngày chính thức", {}]
  ])(
    "từ Chính thức về Thử việc (%s) → xoá ngày chính thức và ngày hết thử việc",
    async (_l, extra) => {
      const employee = await createEmployee({
        start_date: new Date("2026-08-01T00:00:00+07:00"),
        probation_end_date: new Date("2026-09-30T00:00:00+07:00"),
        employment_status: officialStatus._id,
        ...extra
      });
      const res = await setEmploymentStatus(employee._id, probationStatus._id, "2026-10-20");
      expect(res.status).not.toHaveBeenCalled();
      const saved = await UserInfoModel.findById(employee._id);
      expect(saved.official_date).toBeNull();
      expect(saved.probation_end_date).toBeNull();
    }
  );

  test("chuyển sang thử việc → không đụng tới ngày hết thử việc", async () => {
    const employee = await createEmployee({
      start_date: new Date("2026-08-01T00:00:00+07:00"),
      probation_end_date: new Date("2026-11-30T00:00:00+07:00")
    });
    await setEmploymentStatus(employee._id, probationStatus._id, "2026-10-01");
    const saved = await UserInfoModel.findById(employee._id);
    expect(dateKey(saved.probation_end_date)).toBe("2026-11-30");
  });

  test.each([
    ["chính thức", () => officialStatus],
    ["thử việc", () => probationStatus]
  ])("ngày hiệu lực trước ngày vào làm (sang %s) → 400, không đổi gì", async (_label, status) => {
    const employee = await createEmployee({
      start_date: new Date("2026-08-01T00:00:00+07:00"),
      probation_end_date: new Date("2026-09-30T00:00:00+07:00")
    });

    const res = await setEmploymentStatus(employee._id, status()._id, "2026-07-15");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe(
      "Ngày hiệu lực không được trước ngày vào làm (01/08/2026)"
    );
    const saved = await UserInfoModel.findById(employee._id);
    expect(saved.employment_status).toBeNull();
    expect(dateKey(saved.probation_end_date)).toBe("2026-09-30");
    expect(await LeaveBalanceModel.countDocuments({ user_id: employee._id })).toBe(0);
  });

  test("ngày hiệu lực sai định dạng → 400", async () => {
    const employee = await createEmployee();
    const res = await setEmploymentStatus(employee._id, officialStatus._id, "01/10/2026");
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("getUsers — cờ missing_employment_date cho HR bổ sung ngày", () => {
  const viewAll = buildAbility([{ action: "employee.view", subject: "Employee" }]);
  const day = (value) => moment.tz(value, TZ).startOf("day").toDate();

  test("thiếu ngày vào làm / Thử việc thiếu ngày hết; bỏ qua người đủ ngày, đã nghỉ việc và CTV", async () => {
    const noStart = await createEmployee({ full_name: "Thiếu ngày vào làm" });
    await createEmployee({
      full_name: "Thử việc thiếu ngày hết",
      start_date: day("2026-09-01"),
      employment_status: probationStatus._id
    });
    await createEmployee({
      full_name: "Thử việc đủ ngày",
      start_date: day("2026-09-01"),
      probation_end_date: day("2026-10-31"),
      employment_status: probationStatus._id
    });
    await createEmployee({
      full_name: "Chính thức luôn",
      start_date: day("2026-09-01"),
      employment_status: officialStatus._id
    });
    await createEmployee({
      full_name: "Đã nghỉ việc",
      resignation_date: moment.tz(TZ).subtract(2, "day").endOf("day").toDate()
    });
    const ctv = await createEmployee({ full_name: "CTV" });
    const [dept, ctvPosition, staffPosition] = await Promise.all([
      DepartmentModel.create({ department_name: "Khối test", department_code: "KT-MISSING" }),
      PositionModel.create({ position_name: "CTV" }),
      PositionModel.create({ position_name: "Chuyên viên" })
    ]);
    await UserDepartmentPositionModel.create([
      { user: ctv._id, department: dept._id, position: ctvPosition._id },
      { user: noStart._id, department: dept._id, position: staffPosition._id }
    ]);

    const res = makeRes();
    await UserController.getUsers({ query: { limit: 50 }, permissionAbility: viewAll }, res);
    const flags = Object.fromEntries(
      res.json.mock.calls[0][0].data.map((u) => [u.full_name, u.missing_employment_date])
    );

    expect(flags).toEqual({
      "Thiếu ngày vào làm": "start_date",
      "Thử việc thiếu ngày hết": "probation_end_date",
      "Thử việc đủ ngày": null,
      "Chính thức luôn": null,
      "Đã nghỉ việc": null,
      CTV: null
    });
  });
});

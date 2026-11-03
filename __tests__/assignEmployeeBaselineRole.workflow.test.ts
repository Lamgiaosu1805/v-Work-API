import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { assignEmployeeBaselineRole } from "../src/workflows/assign-employee-baseline-role.workflow";
import { logger } from "../src/config/logger";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");

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
  jest.restoreAllMocks();
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    AccountModel.deleteMany({})
  ]);
});

async function createEmployee(maNv: string) {
  const account = await AccountModel.create({ username: `user-${maNv}`, password: "x" });
  const userInfo = await UserInfoModel.create({
    full_name: `Employee ${maNv}`,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
  return String(userInfo._id);
}

async function findRoleIds(employeeId: string): Promise<string[]> {
  const profile = await EmployeePermissionProfileModel.findOne({ employeeId }).lean();
  return (profile?.roleIds ?? []).map((id) => String(id));
}

describe("assignEmployeeBaselineRole — tự gán role mặc định khi tạo nhân viên", () => {
  test("nhân viên mới chưa có profile -> tạo profile chứa EMPLOYEE_BASELINE", async () => {
    const baseline = await PermissionRoleModel.create({
      name: "Nhân viên cơ bản",
      code: "EMPLOYEE_BASELINE",
      grants: []
    });
    const employeeId = await createEmployee("NV-BASE-A");

    await expect(assignEmployeeBaselineRole(employeeId)).resolves.toBe(true);

    expect(await findRoleIds(employeeId)).toEqual([String(baseline._id)]);
  });

  test("đã có role khác + override -> giữ nguyên, chỉ thêm EMPLOYEE_BASELINE; gọi lại không nhân đôi", async () => {
    const baseline = await PermissionRoleModel.create({
      name: "Nhân viên cơ bản",
      code: "EMPLOYEE_BASELINE",
      grants: []
    });
    const otherRole = await PermissionRoleModel.create({ name: "Khác", code: "OTHER", grants: [] });
    const employeeId = await createEmployee("NV-BASE-B");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [otherRole._id],
      overrides: [{ permissionCode: "payroll.view", status: "BLOCK" }]
    });

    await assignEmployeeBaselineRole(employeeId);
    await assignEmployeeBaselineRole(employeeId);

    const profile = await EmployeePermissionProfileModel.findOne({ employeeId }).lean();
    expect((profile?.roleIds ?? []).map(String).sort()).toEqual(
      [String(otherRole._id), String(baseline._id)].sort()
    );
    expect(profile?.overrides.map((override) => override.permissionCode)).toEqual(["payroll.view"]);
  });

  test("role chưa seed -> không ném lỗi, không tạo profile, trả false", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    const employeeId = await createEmployee("NV-BASE-C");

    await expect(assignEmployeeBaselineRole(employeeId)).resolves.toBe(false);

    expect(await findRoleIds(employeeId)).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("nhân viên không tồn tại -> nuốt lỗi, log error, trả false", async () => {
    await PermissionRoleModel.create({
      name: "Nhân viên cơ bản",
      code: "EMPLOYEE_BASELINE",
      grants: []
    });
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => logger);

    await expect(
      assignEmployeeBaselineRole(new mongoose.Types.ObjectId().toString())
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});

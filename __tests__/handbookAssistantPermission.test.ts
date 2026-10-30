import path from "path";
import { spawn } from "child_process";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import express, { Request, Response } from "express";
import redisMock from "./mocks/redis";

jest.mock("../src/middlewares/authMiddleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-account"]) {
      return res.status(401).json({ message: "Chưa đăng nhập" });
    }
    req.account = { _id: req.headers["x-test-account"] };
    return next();
  }
}));

/* eslint-disable import/first */
import { requirePermission } from "../src/core/authorization/require-permission.middleware";
import { errorHandlerMiddleware } from "../src/core/http/error-handler.middleware";
import { getMyEffectivePermissions } from "../src/modules/permission";
import UserInfoModel from "../src/models/UserInfoModel";
import AccountModel from "../src/models/AccountModel";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
/* eslint-enable import/first */

const ROOT = path.resolve(__dirname, "..");
const CODE = "handbook_assistant.use";
// Đúng thứ tự trong scripts/seedPermissionAll.ts (phần liên quan tới quyền này).
const SEEDS = [
  "seedPermissionCatalog.ts",
  "seedPermissionDataScopePolicy.ts",
  "seedPermissionEntityAttributeCatalog.ts",
  "seedPermissionAdminRole.ts",
  "seedPermissionEmployeeBaselineRole.ts"
];

// spawn bất đồng bộ: mongod tạm ghi log vào pipe của tiến trình test, chặn event loop có thể gây deadlock.
function runSeed(script: string, uri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register/transpile-only", path.join(ROOT, "scripts", script)],
      { cwd: ROOT, env: { ...process.env, MONGODB_URI: uri } }
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} thoát mã ${code}:\n${out}`))
    );
  });
}

let mongod: MongoMemoryServer;
let app: express.Express;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("handbook_perm");
  for (const script of SEEDS) {
    await runSeed(script, uri);
  }
  await mongoose.connect(uri);

  app = express();
  app.use(express.json());
  const { authenticate } = jest.requireMock("../src/middlewares/authMiddleware");
  app.post(
    "/handbook-assistant/ask-probe",
    authenticate,
    requirePermission(CODE, "HandbookAssistant"),
    (_req: Request, res: Response) => {
      res.status(200).json({ message: "OK" });
    }
  );
  app.use(errorHandlerMiddleware);
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  redisMock.__store.clear();
});

let seq = 0;
async function createEmployee(options: { role?: "user" | "admin"; roleCode?: string } = {}) {
  seq += 1;
  const account = await AccountModel.create({
    username: `hb_${Date.now()}_${seq}`,
    password: "x",
    role: options.role ?? "user"
  });
  const userInfo = await UserInfoModel.create({
    full_name: `NV Handbook ${seq}`,
    cccd: `${Date.now()}${seq}`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `HB${Date.now()}${seq}`,
    employment_type: "fulltime"
  });
  if (options.roleCode) {
    const role = await PermissionRoleModel.findOne({ code: options.roleCode });
    await EmployeePermissionProfileModel.create({
      employeeId: userInfo._id,
      roleIds: [role?._id],
      overrides: []
    });
  }
  return { account, userInfo };
}

const probe = (accountId: unknown) =>
  request(app).post("/handbook-assistant/ask-probe").set("x-test-account", String(accountId));

describe("Quyền handbook_assistant.use sau khi chạy seed", () => {
  it("có trong catalog: workplace / HandbookAssistant / WRITE, scope toàn công ty", async () => {
    const entry = await PermissionCatalogModel.findOne({ code: CODE }).lean();
    expect(entry).toMatchObject({
      module: "workplace",
      entity: "HandbookAssistant",
      actionKind: "WRITE",
      validDataScopePolicies: ["HANDBOOK_ASSISTANT_ALL_COMPANY"]
    });
  });

  it("role Nhân viên (EMPLOYEE_BASELINE) có grant với scope toàn công ty", async () => {
    const role = await PermissionRoleModel.findOne({ code: "EMPLOYEE_BASELINE" }).lean();
    expect(role?.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          permissionCode: CODE,
          dataScopePolicyCode: "HANDBOOK_ASSISTANT_ALL_COMPANY"
        })
      ])
    );
  });

  it("nhân viên có role EMPLOYEE_BASELINE: qua requirePermission và hiện trong /permissions/me", async () => {
    const { account, userInfo } = await createEmployee({ roleCode: "EMPLOYEE_BASELINE" });

    expect((await probe(account._id)).status).toBe(200);
    expect(await getMyEffectivePermissions(String(userInfo._id))).toContain(CODE);
  });

  it("nhân viên chưa được gán role nào: 403 và không có quyền trong /permissions/me", async () => {
    const { account, userInfo } = await createEmployee();

    const res = await probe(account._id);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Bạn không có quyền thực hiện thao tác này");
    expect(await getMyEffectivePermissions(String(userInfo._id))).not.toContain(CODE);
  });

  it("role PERMISSION_ADMIN (admin) cũng có quyền — admin không được bypass nên phải seed đủ", async () => {
    const { account, userInfo } = await createEmployee({
      role: "admin",
      roleCode: "PERMISSION_ADMIN"
    });

    expect((await probe(account._id)).status).toBe(200);
    expect(await getMyEffectivePermissions(String(userInfo._id))).toContain(CODE);
  });

  it("chưa đăng nhập: 401", async () => {
    const res = await request(app).post("/handbook-assistant/ask-probe");
    expect(res.status).toBe(401);
  });

  it("chạy lại toàn bộ seed là idempotent (không lỗi, không nhân đôi)", async () => {
    const uri = mongod.getUri("handbook_perm");
    for (const script of SEEDS) {
      await runSeed(script, uri);
    }
    expect(await PermissionCatalogModel.countDocuments({ code: CODE })).toBe(1);
    expect(await PermissionRoleModel.countDocuments({ code: "EMPLOYEE_BASELINE" })).toBe(1);
    const role = await PermissionRoleModel.findOne({ code: "EMPLOYEE_BASELINE" }).lean();
    expect(role?.grants.filter((g) => g.permissionCode === CODE)).toHaveLength(1);
  });
});

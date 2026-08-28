import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createRole } from "../src/modules/permission/application/create-role.service";
import { RoleRepository } from "../src/modules/permission/infrastructure/role.repository";
import { DuplicateRoleCodeError } from "../src/modules/permission/domain/permission.errors";
import PermissionRoleModel from "../src/models/PermissionRoleModel";

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
  await PermissionRoleModel.deleteMany({});
});

describe("createRole", () => {
  test("tạo role thành công khi mã chưa tồn tại", async () => {
    const role = await createRole({ name: "Trưởng phòng Nhân sự", code: "HR_MANAGER" });
    expect(role.code).toBe("HR_MANAGER");

    const doc = await PermissionRoleModel.findOne({ code: "HR_MANAGER" }).lean();
    expect(doc).not.toBeNull();
  });

  test("tên có khoảng trống đầu/cuối -> tự động trim trước khi lưu", async () => {
    const role = await createRole({ name: "  Trưởng phòng Kinh doanh  ", code: "SALE_MANAGER" });
    expect(role.name).toBe("Trưởng phòng Kinh doanh");

    const doc = await PermissionRoleModel.findOne({ code: "SALE_MANAGER" }).lean();
    expect(doc?.name).toBe("Trưởng phòng Kinh doanh");
  });

  test("ném DuplicateRoleCodeError khi mã đã tồn tại (qua findByCode pre-check)", async () => {
    await createRole({ name: "Role A", code: "DUP_CODE" });
    await expect(createRole({ name: "Role B", code: "DUP_CODE" })).rejects.toThrow(
      DuplicateRoleCodeError
    );
  });

  test("race condition thật: 2 request tạo cùng mã gần như đồng thời -> đúng 1 thành công, 1 bị từ chối sạch", async () => {
    const results = await Promise.allSettled([
      createRole({ name: "Role Race A", code: "RACE_CODE" }),
      createRole({ name: "Role Race B", code: "RACE_CODE" })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DuplicateRoleCodeError);

    const count = await PermissionRoleModel.countDocuments({ code: "RACE_CODE" });
    expect(count).toBe(1);
  });

  test("findByCode pre-check bị race (giả lập không thấy trùng) -> insert() vẫn bị unique index chặn, convert đúng thành DuplicateRoleCodeError, không lộ raw Mongo error", async () => {
    await createRole({ name: "Role Existing", code: "RACE_CODE_2" });

    const spy = jest.spyOn(RoleRepository.prototype, "findByCode").mockResolvedValueOnce(null);

    try {
      await expect(createRole({ name: "Role New", code: "RACE_CODE_2" })).rejects.toThrow(
        DuplicateRoleCodeError
      );
    } finally {
      spy.mockRestore();
    }

    const count = await PermissionRoleModel.countDocuments({ code: "RACE_CODE_2" });
    expect(count).toBe(1);
  });
});

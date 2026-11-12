import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Tạo / sửa / xoá phòng ban phải xoá cache danh bạ (cây phòng ban dùng cho quyền xem ticket) để đổi có hiệu lực ngay.

const mockInvalidate = jest.fn();
jest.mock("../src/core/cache/ttl-cache", () => ({
  ...jest.requireActual("../src/core/cache/ttl-cache"),
  invalidateDirectoryCaches: () => mockInvalidate()
}));
jest.mock("../src/jobs/ensureDeptFolders", () => ({ ensureFolderForDept: jest.fn() }));
jest.mock("../src/core/authorization/invalidate-permission-cache", () => ({
  invalidatePermissionCache: jest.fn().mockResolvedValue(undefined)
}));

// eslint-disable-next-line import/first
import DepartmentModel from "../src/models/DepartmentModel";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const controller = require("../src/controllers/DepartmentPositionController");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await DepartmentModel.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await DepartmentModel.deleteMany({});
  mockInvalidate.mockClear();
});

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("DepartmentPositionController — xoá cache danh bạ khi ghi phòng ban", () => {
  it("tạo phòng ban thành công thì xoá cache", async () => {
    const res = makeRes();
    await controller.createDepartment(
      { body: { department_name: "IT", department_code: "it", type: "department" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("tạo lỗi (thiếu tên) thì không xoá cache", async () => {
    const res = makeRes();
    await controller.createDepartment({ body: { department_code: "x" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("sửa phòng ban thành công thì xoá cache; không tìm thấy thì không", async () => {
    const dept = await DepartmentModel.create({
      department_name: "A",
      department_code: "a",
      type: "department"
    });

    const ok = makeRes();
    await controller.updateDepartment(
      { params: { id: String(dept._id) }, body: { department_name: "A2" } },
      ok
    );
    expect(ok.status).toHaveBeenCalledWith(200);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);

    mockInvalidate.mockClear();
    const missing = makeRes();
    await controller.updateDepartment(
      { params: { id: String(new mongoose.Types.ObjectId()) }, body: { department_name: "Z" } },
      missing
    );
    expect(missing.status).toHaveBeenCalledWith(404);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("xoá phòng ban thành công thì xoá cache", async () => {
    const dept = await DepartmentModel.create({
      department_name: "B",
      department_code: "b",
      type: "department"
    });
    const res = makeRes();
    await controller.deleteDepartment({ params: { id: String(dept._id) } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});

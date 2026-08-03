import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import ShiftModel from "../../../src/models/ShiftModel";
import {
  listShifts,
  createShift
} from "../../../src/modules/attendance/application/manage-shift.service";
import { ArgumentInvalidException } from "../../../src/core/exceptions/exceptions";

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
  await ShiftModel.deleteMany({});
});

describe("listShifts", () => {
  test("trả về tất cả shift đã tạo", async () => {
    await ShiftModel.create({ name: "Ca sáng", start_time: "08:00", end_time: "12:00" });
    await ShiftModel.create({ name: "Ca chiều", start_time: "13:00", end_time: "17:30" });

    const result = await listShifts();
    expect(result).toHaveLength(2);
  });
});

describe("createShift", () => {
  test("thiếu name/start_time/end_time: throw 400", async () => {
    await expect(
      createShift({ name: undefined, start_time: "08:00", end_time: "17:30" })
    ).rejects.toThrow("name, start_time, end_time là bắt buộc");
  });

  test("tên đã tồn tại: throw 400", async () => {
    await ShiftModel.create({ name: "Ca sáng", start_time: "08:00", end_time: "12:00" });

    const err = await createShift({
      name: "Ca sáng",
      start_time: "08:00",
      end_time: "12:00"
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArgumentInvalidException);
    expect(err.message).toBe("Shift Ca sáng đã tồn tại");
  });

  test("thành công: không truyền late_allowance_minutes -> mặc định 0 (ghi đè default 5 của schema)", async () => {
    const shift = await createShift({ name: "Ca sáng", start_time: "08:00", end_time: "12:00" });
    expect(shift.late_allowance_minutes).toBe(0);
  });

  test("thành công: dùng late_allowance_minutes truyền vào", async () => {
    const shift = await createShift({
      name: "Ca sáng",
      start_time: "08:00",
      end_time: "12:00",
      late_allowance_minutes: 10
    });
    expect(shift.late_allowance_minutes).toBe(10);
  });
});

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import ShiftModel from "../../../src/models/ShiftModel";
import { ShiftRepository } from "../../../src/modules/attendance/infrastructure/shift.repository";

let mongod: MongoMemoryServer;
const repository = new ShiftRepository();

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

describe("ShiftRepository", () => {
  test("findAll: trả tất cả shift, không lọc isDeleted (giữ đúng hành vi gốc)", async () => {
    await ShiftModel.create({ name: "Ca sáng", start_time: "08:00", end_time: "12:00" });
    await ShiftModel.create({
      name: "Ca đã xoá",
      start_time: "08:00",
      end_time: "12:00",
      isDeleted: true
    });
    const shifts = await repository.findAll();
    expect(shifts.map((s) => s.name).sort()).toEqual(["Ca sáng", "Ca đã xoá"].sort());
  });

  test("findByName: tìm đúng theo name", async () => {
    await ShiftModel.create({ name: "Ca hành chính", start_time: "08:00", end_time: "17:30" });
    const found = await repository.findByName("Ca hành chính");
    expect(found?.start_time).toBe("08:00");
    expect(await repository.findByName("Không tồn tại")).toBeNull();
  });

  test("create: không truyền late_allowance_minutes -> mặc định 0 (KHÔNG phải 5 của schema)", async () => {
    const shift = await repository.create({
      name: "Ca sáng",
      start_time: "08:00",
      end_time: "12:00"
    });
    expect(shift.late_allowance_minutes).toBe(0);
  });

  test("create: dùng late_allowance_minutes truyền vào nếu có", async () => {
    const shift = await repository.create({
      name: "Ca sáng",
      start_time: "08:00",
      end_time: "12:00",
      late_allowance_minutes: 10
    });
    expect(shift.late_allowance_minutes).toBe(10);
  });
});

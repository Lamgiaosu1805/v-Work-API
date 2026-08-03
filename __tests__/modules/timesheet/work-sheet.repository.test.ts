import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import WorkSheetModel from "../../../src/models/WorkSheetModel";
import ShiftModel from "../../../src/models/ShiftModel";
import { WorkSheetRepository } from "../../../src/modules/timesheet/infrastructure/work-sheet.repository";

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
  await WorkSheetModel.deleteMany({});
  await ShiftModel.deleteMany({});
});

describe("WorkSheetRepository", () => {
  test("findByUserAndDate: tìm đúng worksheet theo user+ngày, populate shifts đúng field", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const date = new Date("2026-07-01T00:00:00.000Z");
    const created = await WorkSheetModel.create({
      user_id: userId,
      date,
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    const repo = new WorkSheetRepository();
    const record = await repo.findByUserAndDate(userId.toString(), date);

    expect(record).not.toBeNull();
    expect(record?.id).toBe(created._id.toString());
    expect(record?.user_id).toBe(userId.toString());
    expect(record?.shifts).toEqual([{ start_time: "08:00", end_time: "17:30" }]);
  });

  test("findByUserAndDate: không tìm thấy -> null", async () => {
    const repo = new WorkSheetRepository();
    const record = await repo.findByUserAndDate(
      new mongoose.Types.ObjectId().toString(),
      new Date("2026-07-01")
    );
    expect(record).toBeNull();
  });

  test("findByUserAndDate: worksheet isDeleted:true không được tìm thấy", async () => {
    const userId = new mongoose.Types.ObjectId();
    const date = new Date("2026-07-01T00:00:00.000Z");
    await WorkSheetModel.create({ user_id: userId, date, isDeleted: true });

    const repo = new WorkSheetRepository();
    const record = await repo.findByUserAndDate(userId.toString(), date);
    expect(record).toBeNull();
  });

  test("applyComputedResult: ghi đúng field, không đụng field khác (shifts/date/user_id)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const date = new Date("2026-07-01T00:00:00.000Z");
    const created = await WorkSheetModel.create({ user_id: userId, date });

    const repo = new WorkSheetRepository();
    const newCheckIn = new Date("2026-07-01T01:00:00.000Z");
    const newCheckOut = new Date("2026-07-01T10:00:00.000Z");
    await repo.applyComputedResult(created._id.toString(), {
      check_in: newCheckIn,
      check_out: newCheckOut,
      minutes_late: 5,
      minute_early: 10,
      work_unit: 1,
      penalty_amount: 50000
    });

    const updated = await WorkSheetModel.findById(created._id).lean();
    expect(updated?.check_in).toEqual(newCheckIn);
    expect(updated?.check_out).toEqual(newCheckOut);
    expect(updated?.minutes_late).toBe(5);
    expect(updated?.minute_early).toBe(10);
    expect(updated?.work_unit).toBe(1);
    expect(updated?.penalty_amount).toBe(50000);
    expect(updated?.user_id.toString()).toBe(userId.toString());
  });
});

describe("WorkSheetRepository — ranh giới ngày theo Asia/Ho_Chi_Minh (regression, xem 1.8.3.6)", () => {
  // Lưu ý quan trọng: KHÔNG dùng cách mutate `process.env.TZ` giữa chừng trong Jest để giả lập server
  // chạy timezone khác — đã tự verify Jest/V8 cache timezone lúc process khởi động, mutate giữa chừng
  // KHÔNG có tác dụng (khác hẳn với chạy `TZ=xxx node -e ...` từ shell, nơi env var có tác dụng thật).
  // Test này verify bằng mốc UTC CỐ ĐỊNH (không phụ thuộc timezone máy chạy test) — bug gốc (dùng
  // Date.setHours/setDate theo timezone LOCAL của server) đã được verify + reproduce thật bằng
  // process con riêng (`TZ=America/New_York node -e ...`, lệch đúng 13 tiếng) trước khi sửa, xem plan
  // doc mục 1.8.3.6.
  test("00:00 giờ VN (=17:00 UTC hôm trước) và 23:59:59 giờ VN (=16:59:59 UTC hôm sau) đều thuộc đúng 1 ngày", async () => {
    const userId = new mongoose.Types.ObjectId();
    // 00:00 01/07/2026 giờ VN = 17:00 30/06/2026 UTC
    const vnMidnight = new Date("2026-06-30T17:00:00.000Z");
    const created = await WorkSheetModel.create({
      user_id: userId,
      date: vnMidnight,
      check_in: null,
      check_out: null
    });

    const repo = new WorkSheetRepository();

    // Truyền vào đúng lúc nửa đêm VN -> phải tìm thấy
    const found = await repo.findByUserAndDate(userId.toString(), vnMidnight);
    expect(found?.id).toBe(created._id.toString());

    // Truyền vào 23:59:59 giờ VN CÙNG ngày (= 16:59:59 UTC hôm sau) -> vẫn phải tìm thấy (cùng ngày VN)
    const vnEndOfDay = new Date("2026-07-01T16:59:59.000Z");
    const foundEndOfDay = await repo.findByUserAndDate(userId.toString(), vnEndOfDay);
    expect(foundEndOfDay?.id).toBe(created._id.toString());

    // Truyền vào 17:00:00 UTC (= 00:00:00 giờ VN NGÀY HÔM SAU) -> KHÔNG được tìm thấy (khác ngày)
    const nextDayStart = new Date("2026-07-01T17:00:00.000Z");
    const notFound = await repo.findByUserAndDate(userId.toString(), nextDayStart);
    expect(notFound).toBeNull();
  });
});

describe("WorkSheetRepository.upsertRawPunch", () => {
  const dayStart = new Date("2026-06-30T17:00:00.000Z"); // 00:00 01/07/2026 giờ VN

  test("chưa có worksheet cho ngày đó: tạo mới với shifts:[] + field punch được truyền vào", async () => {
    const userId = new mongoose.Types.ObjectId();
    const checkIn = new Date("2026-07-01T01:00:00.000Z");

    const repo = new WorkSheetRepository();
    const record = await repo.upsertRawPunch(userId.toString(), dayStart, { check_in: checkIn });

    expect(record.check_in).toEqual(checkIn);
    expect(record.check_out).toBeNull();
    expect(record.shifts).toEqual([]);

    const count = await WorkSheetModel.countDocuments({ user_id: userId });
    expect(count).toBe(1);
  });

  test("đã có worksheet với shift thật: chỉ update field punch, KHÔNG ghi đè shifts thành rỗng", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await WorkSheetModel.create({
      user_id: userId,
      date: dayStart,
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    const checkOut = new Date("2026-07-01T10:31:00.000Z");
    const repo = new WorkSheetRepository();
    const record = await repo.upsertRawPunch(userId.toString(), dayStart, { check_out: checkOut });

    expect(record.check_out).toEqual(checkOut);
    expect(record.shifts).toEqual([{ start_time: "08:00", end_time: "17:30" }]); // giữ nguyên, không rỗng

    const count = await WorkSheetModel.countDocuments({ user_id: userId });
    expect(count).toBe(1); // không tạo thêm doc mới
  });

  test("chỉ truyền check_in: không đụng đến check_out đã có sẵn", async () => {
    const userId = new mongoose.Types.ObjectId();
    const existingCheckOut = new Date("2026-07-01T10:31:00.000Z");
    await WorkSheetModel.create({
      user_id: userId,
      date: dayStart,
      shifts: [],
      check_in: null,
      check_out: existingCheckOut
    });

    const newCheckIn = new Date("2026-07-01T01:00:00.000Z");
    const repo = new WorkSheetRepository();
    const record = await repo.upsertRawPunch(userId.toString(), dayStart, { check_in: newCheckIn });

    expect(record.check_in).toEqual(newCheckIn);
    expect(record.check_out).toEqual(existingCheckOut); // không đổi
  });
});

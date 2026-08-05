import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import WorkDayStatusModel from "../../../src/models/WorkDayStatusModel";
import { WorkDayStatusRepository } from "../../../src/modules/timesheet/infrastructure/work-day-status.repository";

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
  await WorkDayStatusModel.deleteMany({});
});

describe("WorkDayStatusRepository.applyAttendanceDrivenStatus", () => {
  const userId = new mongoose.Types.ObjectId();
  const worksheetId = new mongoose.Types.ObjectId();
  const dayStart = new Date("2026-07-01T00:00:00.000Z");
  const dayEnd = new Date("2026-07-02T00:00:00.000Z");

  test("cùng status cả 2 buổi: tạo 1 doc period='full', xoá doc period morning/afternoon cũ", async () => {
    // seed sẵn 1 doc morning cũ (attendance-driven) phải bị xoá
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: worksheetId,
      date: dayStart,
      period: "morning",
      status: "missed_clock",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.applyAttendanceDrivenStatus({
      userId: userId.toString(),
      worksheetId: worksheetId.toString(),
      dayStart,
      dayEnd,
      morningStatus: "present",
      afternoonStatus: "present"
    });

    const docs = await WorkDayStatusModel.find({ user_id: userId, date: dayStart });
    expect(docs).toHaveLength(1);
    expect(docs[0].period).toBe("full");
    expect(docs[0].status).toBe("present");
  });

  test("full doc đã tồn tại: status được ghi đè (nhánh dùng $set, không phải $setOnInsert)", async () => {
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: worksheetId,
      date: dayStart,
      period: "full",
      status: "absent",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.applyAttendanceDrivenStatus({
      userId: userId.toString(),
      worksheetId: worksheetId.toString(),
      dayStart,
      dayEnd,
      morningStatus: "present",
      afternoonStatus: "present"
    });

    const doc = await WorkDayStatusModel.findOne({
      user_id: userId,
      date: dayStart,
      period: "full"
    });
    expect(doc?.status).toBe("present"); // ghi đè thành công
  });

  test("khác status theo buổi: tạo 2 doc morning/afternoon riêng", async () => {
    const repo = new WorkDayStatusRepository();
    await repo.applyAttendanceDrivenStatus({
      userId: userId.toString(),
      worksheetId: worksheetId.toString(),
      dayStart,
      dayEnd,
      morningStatus: "present",
      afternoonStatus: "missed_clock"
    });

    const morning = await WorkDayStatusModel.findOne({
      user_id: userId,
      date: dayStart,
      period: "morning"
    });
    const afternoon = await WorkDayStatusModel.findOne({
      user_id: userId,
      date: dayStart,
      period: "afternoon"
    });
    expect(morning?.status).toBe("present");
    expect(afternoon?.status).toBe("missed_clock");
  });

  // Business rule ẩn phát hiện khi đọc kỹ bản gốc: nhánh "khác status theo buổi" dùng $setOnInsert
  // (không phải $set) — nếu 1 buổi đã có status QUYẾT ĐỊNH THỦ CÔNG (leave_paid/remote/business_trip
  // — decision-driven, KHÔNG nằm trong ATTENDANCE_DRIVEN_STATUSES nên deleteMany không xoá được),
  // status đó phải được GIỮ NGUYÊN, không bị tính toán chấm công tự động ghi đè.
  test("buổi sáng đã có status quyết định thủ công (leave_paid) — KHÔNG bị ghi đè bởi tính toán chấm công", async () => {
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: worksheetId,
      date: dayStart,
      period: "morning",
      status: "leave_paid",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.applyAttendanceDrivenStatus({
      userId: userId.toString(),
      worksheetId: worksheetId.toString(),
      dayStart,
      dayEnd,
      morningStatus: "present", // tính toán chấm công muốn ghi "present"
      afternoonStatus: "missed_clock"
    });

    const morning = await WorkDayStatusModel.findOne({
      user_id: userId,
      date: dayStart,
      period: "morning"
    });
    expect(morning?.status).toBe("leave_paid"); // vẫn giữ nguyên, không bị ghi đè thành "present"
  });
});

describe("WorkDayStatusRepository.findLeaveStatusesForDay / markStatusesPresent", () => {
  const userId = new mongoose.Types.ObjectId();
  const worksheetId = new mongoose.Types.ObjectId();
  const dayStart = new Date("2026-07-01T00:00:00.000Z");
  const dayEnd = new Date("2026-07-01T23:59:59.999Z");

  test("findLeaveStatusesForDay: chỉ lấy leave_paid/leave_unpaid, không lấy status khác", async () => {
    await WorkDayStatusModel.create([
      {
        user_id: userId,
        worksheet_id: worksheetId,
        date: dayStart,
        period: "morning",
        status: "leave_paid",
        sources: []
      },
      {
        user_id: userId,
        worksheet_id: worksheetId,
        date: dayStart,
        period: "afternoon",
        status: "leave_unpaid",
        sources: []
      }
    ]);

    const repo = new WorkDayStatusRepository();
    const result = await repo.findLeaveStatusesForDay(userId.toString(), dayStart, dayEnd);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.status).sort()).toEqual(["leave_paid", "leave_unpaid"]);
  });

  test("findLeaveStatusesForDay: không lấy doc isDeleted:true", async () => {
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: worksheetId,
      date: dayStart,
      period: "full",
      status: "leave_paid",
      sources: [],
      isDeleted: true
    });

    const repo = new WorkDayStatusRepository();
    const result = await repo.findLeaveStatusesForDay(userId.toString(), dayStart, dayEnd);
    expect(result).toEqual([]);
  });

  test("findLeaveStatusesForDay: không có gì trong ngày -> mảng rỗng", async () => {
    const repo = new WorkDayStatusRepository();
    const result = await repo.findLeaveStatusesForDay(userId.toString(), dayStart, dayEnd);
    expect(result).toEqual([]);
  });

  test("markStatusesPresent: flip đúng status + gắn worksheet_id + thêm source attendance", async () => {
    const doc = await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: new mongoose.Types.ObjectId(),
      date: dayStart,
      period: "morning",
      status: "leave_paid",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.markStatusesPresent([doc._id.toString()], worksheetId.toString());

    const updated = await WorkDayStatusModel.findById(doc._id);
    expect(updated?.status).toBe("present");
    expect(updated?.worksheet_id.toString()).toBe(worksheetId.toString());
    expect(updated?.sources).toHaveLength(1);
    expect(updated?.sources[0].ref_type).toBe("attendance");
  });

  test("markStatusesPresent: mảng rỗng -> không làm gì, không lỗi", async () => {
    const repo = new WorkDayStatusRepository();
    await expect(repo.markStatusesPresent([], worksheetId.toString())).resolves.not.toThrow();
  });
});

// task 1.8.4.8 — port AttendanceController.checkOut's WorkDayStatusModel.updateMany({status:"pending"}).
describe("WorkDayStatusRepository.markPendingAsPresent", () => {
  test("flip đúng status 'pending' của worksheet đó thành 'present', gắn source attendance", async () => {
    const worksheetId = new mongoose.Types.ObjectId();
    const doc = await WorkDayStatusModel.create({
      user_id: new mongoose.Types.ObjectId(),
      worksheet_id: worksheetId,
      date: new Date("2026-07-01T00:00:00.000Z"),
      period: "full",
      status: "pending",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.markPendingAsPresent(worksheetId.toString());

    const updated = await WorkDayStatusModel.findById(doc._id);
    expect(updated?.status).toBe("present");
    expect(updated?.sources).toHaveLength(1);
    expect(updated?.sources[0].ref_type).toBe("attendance");
  });

  test("không đụng status khác 'pending' (vd đã 'present'/'leave_paid') của cùng worksheet", async () => {
    const worksheetId = new mongoose.Types.ObjectId();
    const leaveDoc = await WorkDayStatusModel.create({
      user_id: new mongoose.Types.ObjectId(),
      worksheet_id: worksheetId,
      date: new Date("2026-07-01T00:00:00.000Z"),
      period: "morning",
      status: "leave_paid",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.markPendingAsPresent(worksheetId.toString());

    const unchanged = await WorkDayStatusModel.findById(leaveDoc._id);
    expect(unchanged?.status).toBe("leave_paid");
  });

  test("không đụng doc 'pending' của worksheet KHÁC", async () => {
    const worksheetId = new mongoose.Types.ObjectId();
    const otherWorksheetId = new mongoose.Types.ObjectId();
    const otherDoc = await WorkDayStatusModel.create({
      user_id: new mongoose.Types.ObjectId(),
      worksheet_id: otherWorksheetId,
      date: new Date("2026-07-01T00:00:00.000Z"),
      period: "full",
      status: "pending",
      sources: []
    });

    const repo = new WorkDayStatusRepository();
    await repo.markPendingAsPresent(worksheetId.toString());

    const unchanged = await WorkDayStatusModel.findById(otherDoc._id);
    expect(unchanged?.status).toBe("pending");
  });

  test("không có doc 'pending' nào: không lỗi", async () => {
    const repo = new WorkDayStatusRepository();
    await expect(
      repo.markPendingAsPresent(new mongoose.Types.ObjectId().toString())
    ).resolves.not.toThrow();
  });
});

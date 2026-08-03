import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import WorkDayStatusModel from "../../../src/models/WorkDayStatusModel";
import { applyLeaveConflictOverride } from "../../../src/modules/timesheet/application/apply-leave-conflict-override";

const DATE_KEY = "2026-07-01";

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

describe("applyLeaveConflictOverride — dùng độc lập, không qua persistAttendanceDay (vd checkOut route)", () => {
  test("check-in/check-out phủ cả ngày, có leave_paid full: flip present + hoàn đúng 1 ngày phép", async () => {
    const userId = new mongoose.Types.ObjectId();
    const worksheetId = new mongoose.Types.ObjectId();
    const leaveDoc = await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: new mongoose.Types.ObjectId(),
      date: new Date(`${DATE_KEY}T00:00:00.000Z`),
      period: "full",
      status: "leave_paid",
      sources: []
    });

    const result = await applyLeaveConflictOverride({
      userId: userId.toString(),
      worksheetId: worksheetId.toString(),
      dateKey: DATE_KEY,
      checkInTime: new Date(`${DATE_KEY}T01:00:00.000Z`), // 08:00 giờ VN
      checkOutTime: new Date(`${DATE_KEY}T10:31:00.000Z`), // 17:31 giờ VN
      lastShiftEnd: "17:30"
    });

    expect(result.leaveRefundAmount).toBe(1);
    const updated = await WorkDayStatusModel.findById(leaveDoc._id);
    expect(updated?.status).toBe("present");
    expect(updated?.worksheet_id.toString()).toBe(worksheetId.toString());
  });

  test("không có check-in hoặc check-out: không xử lý gì, refund=0", async () => {
    const userId = new mongoose.Types.ObjectId();
    const result = await applyLeaveConflictOverride({
      userId: userId.toString(),
      worksheetId: new mongoose.Types.ObjectId().toString(),
      dateKey: DATE_KEY,
      checkInTime: null,
      checkOutTime: new Date(`${DATE_KEY}T10:31:00.000Z`),
      lastShiftEnd: "17:30"
    });
    expect(result.leaveRefundAmount).toBe(0);
  });
});

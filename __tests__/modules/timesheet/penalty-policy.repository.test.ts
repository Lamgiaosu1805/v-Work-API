import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import moment from "moment-timezone";
import AttendancePenaltyModel from "../../../src/models/AttendancePenaltyModel";
import { PenaltyPolicyRepository } from "../../../src/modules/timesheet/infrastructure/penalty-policy.repository";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4
const dayStart = () => moment.tz(DATE_KEY, TZ).startOf("day").toDate();

const LATE_TIERS = [
  { from_minutes: 1, to_minutes: 15, penalty_kind: "money", penalty_value: 50000 },
  { from_minutes: 16, to_minutes: 30, penalty_kind: "money", penalty_value: 100000 },
  { from_minutes: 31, to_minutes: 60, penalty_kind: "money", penalty_value: 150000 },
  { from_minutes: 61, to_minutes: 240, penalty_kind: "half_day_money", penalty_value: 50000 }
];

const EARLY_TIERS = [
  { from_minutes: 1, to_minutes: 15, penalty_kind: "money", penalty_value: 50000 },
  { from_minutes: 16, to_minutes: 30, penalty_kind: "money", penalty_value: 100000 }
];

const FORGOT_TIERS = [
  { from_count: 1, to_count: 2, penalty_kind: "work_unit", penalty_value: 0 },
  { from_count: 3, to_count: null, penalty_kind: "money", penalty_value: 100000 }
];

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
  await AttendancePenaltyModel.deleteMany({});
  await AttendancePenaltyModel.insertMany(
    LATE_TIERS.map((t) => ({
      type: "late",
      ...t,
      effective_from: new Date("2020-01-01T00:00:00+07:00"),
      is_active: true
    }))
  );
  await AttendancePenaltyModel.insertMany(
    EARLY_TIERS.map((t) => ({
      type: "early",
      ...t,
      effective_from: new Date("2020-01-01T00:00:00+07:00"),
      is_active: true
    }))
  );
  await AttendancePenaltyModel.insertMany(
    FORGOT_TIERS.map((t) => ({
      type: "forgot",
      ...t,
      effective_from: new Date("2020-01-01T00:00:00+07:00"),
      is_active: true
    }))
  );
  // tier đã tắt (is_active:false) không được lấy
  await AttendancePenaltyModel.create({
    type: "late",
    from_minutes: 1,
    to_minutes: 15,
    penalty_kind: "money",
    penalty_value: 999999,
    effective_from: new Date("2020-01-01T00:00:00+07:00"),
    is_active: false
  });
});

describe("PenaltyPolicyRepository — tra tier thực từ DB", () => {
  test("buildLatePenaltyResolver: đi muộn 20 phút -> phạt 100.000đ, work_unit 1", async () => {
    const repo = new PenaltyPolicyRepository();
    const resolve = await repo.buildLatePenaltyResolver();
    const r = resolve(dayStart(), 20, false);
    expect(r.penalty_amount).toBe(100000);
    expect(r.work_unit).toBe(1);
    expect(r.morning_absent).toBe(false);
  });

  test("buildLatePenaltyResolver: bỏ qua tier is_active:false (không nhầm 999999)", async () => {
    const repo = new PenaltyPolicyRepository();
    const resolve = await repo.buildLatePenaltyResolver();
    const r = resolve(dayStart(), 5, false);
    expect(r.penalty_amount).toBe(50000);
  });

  test("buildEarlyPenaltyResolver: về sớm 20 phút -> phạt 100.000đ", async () => {
    const repo = new PenaltyPolicyRepository();
    const resolve = await repo.buildEarlyPenaltyResolver();
    const r = resolve(dayStart(), 20, false);
    expect(r.penalty_amount).toBe(100000);
    expect(r.work_unit).toBe(1);
  });

  test("buildForgotPenaltyResolver: count=1 -> work_unit=0.5 (tier work_unit); count=3 -> phạt tiền", async () => {
    const repo = new PenaltyPolicyRepository();
    const resolve = await repo.buildForgotPenaltyResolver();
    expect(resolve(dayStart(), 1, false).work_unit).toBe(0.5);
    expect(resolve(dayStart(), 3, false).penalty_amount).toBe(100000);
  });
});

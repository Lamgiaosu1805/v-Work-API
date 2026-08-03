import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendancePenaltyModel from "../../../src/models/AttendancePenaltyModel";
import {
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver
} from "../../../src/modules/timesheet";
import { resolveAttendanceDay } from "../../../src/modules/timesheet/domain/resolve-attendance-day";
import {
  WorksheetSnapshot,
  ForgotInfo,
  ForgotOccurrenceInfo
} from "../../../src/modules/timesheet/domain/types";

const DATE_KEY = "2026-07-01"; // thứ 4

const LATE_TIERS = [
  { from_minutes: 1, to_minutes: 15, penalty_kind: "money", penalty_value: 50000 },
  { from_minutes: 16, to_minutes: 30, penalty_kind: "money", penalty_value: 100000 },
  { from_minutes: 31, to_minutes: 60, penalty_kind: "money", penalty_value: 150000 },
  { from_minutes: 61, to_minutes: 240, penalty_kind: "half_day_money", penalty_value: 50000 }
];

const EARLY_TIERS = [
  { from_minutes: 1, to_minutes: 15, penalty_kind: "money", penalty_value: 50000 },
  { from_minutes: 16, to_minutes: 30, penalty_kind: "money", penalty_value: 100000 },
  { from_minutes: 31, to_minutes: 60, penalty_kind: "money", penalty_value: 150000 },
  { from_minutes: 61, to_minutes: 300, penalty_kind: "half_day_money", penalty_value: 50000 }
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
});

// Port từ __tests__/lateEarlyPenalty.test.js (bản cũ dùng resolveAttendanceDay/attendancePenalty.js
// đã bị xoá ở task 1.8.3.7) — vẫn cần giữ coverage tích hợp thật: PenaltyPolicyRepository (tra tier
// thật từ DB) kết hợp resolveAttendanceDay (domain) cho ca vừa muộn vừa sớm cùng ngày.
describe("resolveAttendanceDay (modules/timesheet) — kết hợp phạt đi muộn + về sớm cùng ngày, tier thật từ DB", () => {
  const worksheet: WorksheetSnapshot = {
    check_in: null,
    check_out: null,
    minutes_late: 0,
    minute_early: 0,
    work_unit: null,
    penalty_amount: 0,
    shifts: [{ start_time: "08:00", end_time: "17:00" }]
  };

  const makeArgs = (rawIn: string, rawOut: string, earlyForgivenSet: Set<string> = new Set()) => ({
    dateKey: DATE_KEY,
    rawIn,
    rawOut,
    worksheet: { ...worksheet },
    forgotMap: new Map<string, ForgotInfo>(),
    forgotOccurrenceMap: new Map<string, ForgotOccurrenceInfo>(),
    lateForgivenSet: new Set<string>(),
    earlyForgivenSet,
    leavePeriodsMap: new Map<string, Set<string>>()
  });

  test("vừa muộn (mốc tiền) vừa sớm (mốc tiền): tiền cộng dồn, công lấy thấp hơn (không bên nào ép nửa ngày -> vẫn 1)", async () => {
    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const result = resolveAttendanceDay({
      ...makeArgs("08:20", "16:40"), // 20 phút muộn, 20 phút sớm (ca 08:00-17:00)
      resolveLatePenalty,
      resolveEarlyPenalty,
      resolveForgotPenalty: () => ({ work_unit: 1, penalty_amount: 0 })
    });
    if (result.skip) throw new Error("expected computed result, got skip");
    expect(result.penalty_amount).toBe(200000); // 100k (muộn 20p) + 100k (sớm 20p)
    expect(result.work_unit).toBe(1);
  });

  test("muộn tới mốc nửa ngày công + sớm mốc tiền: work_unit lấy thấp hơn (0.5), tiền cộng dồn", async () => {
    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const result = resolveAttendanceDay({
      ...makeArgs("09:30", "16:40"), // 90 phút muộn -> half_day_money, 20 phút sớm
      resolveLatePenalty,
      resolveEarlyPenalty,
      resolveForgotPenalty: () => ({ work_unit: 1, penalty_amount: 0 })
    });
    if (result.skip) throw new Error("expected computed result, got skip");
    expect(result.work_unit).toBe(0.5);
    expect(result.penalty_amount).toBe(50000 + 100000); // nửa ngày (50k) + sớm 20p (100k)
    expect(result.morning_absent).toBe(true);
    expect(result.afternoon_absent).toBe(false);
  });

  test("đơn về sớm (late_early, type early_out) đã duyệt cho ngày này: không bị phạt về sớm dù check-out sớm", async () => {
    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const result = resolveAttendanceDay({
      ...makeArgs("08:20", "16:40", new Set([DATE_KEY])),
      resolveLatePenalty,
      resolveEarlyPenalty,
      resolveForgotPenalty: () => ({ work_unit: 1, penalty_amount: 0 })
    });
    if (result.skip) throw new Error("expected computed result, got skip");
    // chỉ còn phạt muộn (20 phút -> 100k), không phạt sớm
    expect(result.penalty_amount).toBe(100000);
    expect(result.work_unit).toBe(1);
  });
});

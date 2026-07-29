const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryServer } = require("mongodb-memory-server");

const AttendancePenaltyModel = require("../src/models/AttendancePenaltyModel");
const { buildLatePenaltyResolver, buildEarlyPenaltyResolver } = require("../src/helpers/attendancePenalty");
const { resolveAttendanceDay } = require("../src/helpers/attendanceHelper");

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
  { from_minutes: 16, to_minutes: 30, penalty_kind: "money", penalty_value: 100000 },
  { from_minutes: 31, to_minutes: 60, penalty_kind: "money", penalty_value: 150000 },
  { from_minutes: 61, to_minutes: 300, penalty_kind: "half_day_money", penalty_value: 50000 }
];

let mongod;

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

describe("buildLatePenaltyResolver / buildEarlyPenaltyResolver — tra tier thực từ DB", () => {
  test.each([
    [5, 50000, 1],
    [20, 100000, 1],
    [45, 150000, 1]
  ])("đi muộn %i phút -> phạt tiền %i, work_unit %i (không mất công)", async (minutes, money, workUnit) => {
    const resolve = await buildLatePenaltyResolver();
    const r = resolve(dayStart(), minutes, false);
    expect(r.penalty_amount).toBe(money);
    expect(r.work_unit).toBe(workUnit);
    expect(r.morning_absent).toBe(false);
  });

  test("đi muộn 90 phút (9h01-12h00): nửa ngày công + trừ 50.000đ", async () => {
    const resolve = await buildLatePenaltyResolver();
    const r = resolve(dayStart(), 90, false);
    expect(r.work_unit).toBe(0.5);
    expect(r.penalty_amount).toBe(50000);
    expect(r.morning_absent).toBe(true);
  });

  test.each([
    [5, 50000],
    [20, 100000],
    [45, 150000]
  ])("về sớm %i phút -> phạt tiền %i, không mất công", async (minutes, money) => {
    const resolve = await buildEarlyPenaltyResolver();
    const r = resolve(dayStart(), minutes, false);
    expect(r.penalty_amount).toBe(money);
    expect(r.work_unit).toBe(1);
    expect(r.afternoon_absent).toBe(false);
  });

  test("về sớm 90 phút (12h00-15h59): nửa ngày công + trừ 50.000đ", async () => {
    const resolve = await buildEarlyPenaltyResolver();
    const r = resolve(dayStart(), 90, false);
    expect(r.work_unit).toBe(0.5);
    expect(r.penalty_amount).toBe(50000);
    expect(r.afternoon_absent).toBe(true);
  });

  test("không muộn/không sớm (0 phút): đủ công, không phạt", async () => {
    const resolveLate = await buildLatePenaltyResolver();
    const resolveEarly = await buildEarlyPenaltyResolver();
    expect(resolveLate(dayStart(), 0, false)).toEqual({ work_unit: 1, penalty_amount: 0, morning_absent: false });
    expect(resolveEarly(dayStart(), 0, false)).toEqual({ work_unit: 1, penalty_amount: 0, afternoon_absent: false });
  });
});

describe("resolveAttendanceDay — kết hợp phạt đi muộn + về sớm cùng ngày", () => {
  const at = (hhmm) => moment.tz(`${DATE_KEY} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();

  const makeArgs = ({ resolveLatePenalty, resolveEarlyPenalty, earlyForgivenSet = new Set() }) => ({
    dateKey: DATE_KEY,
    rawIn: "08:20", // 20 phút muộn (ca 08:00-17:00)
    rawOut: "16:40", // 20 phút sớm
    worksheet: {
      check_in: null,
      check_out: null,
      minutes_late: 0,
      minute_early: 0,
      work_unit: null,
      penalty_amount: 0,
      shifts: [{ start_time: "08:00", end_time: "17:00" }]
    },
    forgotMap: new Map(),
    forgotOccurrenceMap: new Map(),
    lateForgivenSet: new Set(),
    earlyForgivenSet,
    leavePeriodsMap: new Map(),
    resolveLatePenalty,
    resolveEarlyPenalty,
    resolveForgotPenalty: () => ({ work_unit: 1, penalty_amount: 0 })
  });

  test("vừa muộn (mốc tiền) vừa sớm (mốc tiền): tiền cộng dồn, công lấy thấp hơn (không bên nào ép nửa ngày -> vẫn 1)", async () => {
    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const result = resolveAttendanceDay(makeArgs({ resolveLatePenalty, resolveEarlyPenalty }));
    expect(result.penalty_amount).toBe(200000); // 100k (muộn 20p) + 100k (sớm 20p)
    expect(result.work_unit).toBe(1);
  });

  test("muộn tới mốc nửa ngày công + sớm mốc tiền: work_unit lấy thấp hơn (0.5), tiền cộng dồn", async () => {
    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const args = makeArgs({ resolveLatePenalty, resolveEarlyPenalty });
    args.rawIn = "09:30"; // 90 phút muộn -> half_day_money
    const result = resolveAttendanceDay(args);
    expect(result.work_unit).toBe(0.5);
    expect(result.penalty_amount).toBe(50000 + 100000); // nửa ngày (50k) + sớm 20p (100k)
    expect(result.morning_absent).toBe(true);
    expect(result.afternoon_absent).toBe(false);
  });

  test("đơn về sớm (late_early, type early_out) đã duyệt cho ngày này: không bị phạt về sớm dù check-out sớm", async () => {
    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const args = makeArgs({
      resolveLatePenalty,
      resolveEarlyPenalty,
      earlyForgivenSet: new Set([DATE_KEY])
    });
    const result = resolveAttendanceDay(args);
    // chỉ còn phạt muộn (20 phút -> 100k), không phạt sớm
    expect(result.penalty_amount).toBe(100000);
    expect(result.work_unit).toBe(1);
  });
});

import moment from "moment-timezone";
import {
  resolveLatePenaltyFromTiers,
  resolveEarlyPenaltyFromTiers,
  resolveForgotPenaltyFromTiers,
  buildUnifiedForgotOccurrenceMap,
  PenaltyTier
} from "../../../src/modules/timesheet/domain/penalty-tier";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4
const dayStart = () => moment.tz(DATE_KEY, TZ).startOf("day").toDate();
const EFFECTIVE_FROM = new Date("2020-01-01T00:00:00+07:00");

const LATE_TIERS: PenaltyTier[] = [
  {
    from_minutes: 1,
    to_minutes: 15,
    to_count: null,
    from_count: null,
    penalty_kind: "money",
    penalty_value: 50000,
    effective_from: EFFECTIVE_FROM
  },
  {
    from_minutes: 16,
    to_minutes: 30,
    to_count: null,
    from_count: null,
    penalty_kind: "money",
    penalty_value: 100000,
    effective_from: EFFECTIVE_FROM
  },
  {
    from_minutes: 31,
    to_minutes: 60,
    to_count: null,
    from_count: null,
    penalty_kind: "money",
    penalty_value: 150000,
    effective_from: EFFECTIVE_FROM
  },
  {
    from_minutes: 61,
    to_minutes: 240,
    to_count: null,
    from_count: null,
    penalty_kind: "half_day_money",
    penalty_value: 50000,
    effective_from: EFFECTIVE_FROM
  }
];

const EARLY_TIERS: PenaltyTier[] = [
  {
    from_minutes: 1,
    to_minutes: 15,
    to_count: null,
    from_count: null,
    penalty_kind: "money",
    penalty_value: 50000,
    effective_from: EFFECTIVE_FROM
  },
  {
    from_minutes: 16,
    to_minutes: 30,
    to_count: null,
    from_count: null,
    penalty_kind: "money",
    penalty_value: 100000,
    effective_from: EFFECTIVE_FROM
  },
  {
    from_minutes: 31,
    to_minutes: 60,
    to_count: null,
    from_count: null,
    penalty_kind: "money",
    penalty_value: 150000,
    effective_from: EFFECTIVE_FROM
  },
  {
    from_minutes: 61,
    to_minutes: 300,
    to_count: null,
    from_count: null,
    penalty_kind: "half_day_money",
    penalty_value: 50000,
    effective_from: EFFECTIVE_FROM
  }
];

describe("resolveLatePenaltyFromTiers / resolveEarlyPenaltyFromTiers", () => {
  test.each([
    [5, 50000, 1],
    [20, 100000, 1],
    [45, 150000, 1]
  ])(
    "đi muộn %i phút -> phạt tiền %i, work_unit %i (không mất công)",
    (minutes, money, workUnit) => {
      const r = resolveLatePenaltyFromTiers(LATE_TIERS, dayStart(), minutes, false);
      expect(r.penalty_amount).toBe(money);
      expect(r.work_unit).toBe(workUnit);
      expect(r.morning_absent).toBe(false);
    }
  );

  test("đi muộn 90 phút (9h01-12h00): nửa ngày công + trừ 50.000đ", () => {
    const r = resolveLatePenaltyFromTiers(LATE_TIERS, dayStart(), 90, false);
    expect(r.work_unit).toBe(0.5);
    expect(r.penalty_amount).toBe(50000);
    expect(r.morning_absent).toBe(true);
  });

  test.each([
    [5, 50000],
    [20, 100000],
    [45, 150000]
  ])("về sớm %i phút -> phạt tiền %i, không mất công", (minutes, money) => {
    const r = resolveEarlyPenaltyFromTiers(EARLY_TIERS, dayStart(), minutes, false);
    expect(r.penalty_amount).toBe(money);
    expect(r.work_unit).toBe(1);
    expect(r.afternoon_absent).toBe(false);
  });

  test("về sớm 90 phút (12h00-15h59): nửa ngày công + trừ 50.000đ", () => {
    const r = resolveEarlyPenaltyFromTiers(EARLY_TIERS, dayStart(), 90, false);
    expect(r.work_unit).toBe(0.5);
    expect(r.penalty_amount).toBe(50000);
    expect(r.afternoon_absent).toBe(true);
  });

  test("không muộn/không sớm (0 phút): đủ công, không phạt", () => {
    expect(resolveLatePenaltyFromTiers(LATE_TIERS, dayStart(), 0, false)).toEqual({
      work_unit: 1,
      penalty_amount: 0,
      morning_absent: false
    });
    expect(resolveEarlyPenaltyFromTiers(EARLY_TIERS, dayStart(), 0, false)).toEqual({
      work_unit: 1,
      penalty_amount: 0,
      afternoon_absent: false
    });
  });

  test("thứ 7: base = 0.5, không tier áp dụng (0 phút muộn) vẫn giữ base", () => {
    const r = resolveLatePenaltyFromTiers(LATE_TIERS, dayStart(), 0, true);
    expect(r.work_unit).toBe(0.5);
  });

  test("không có tier nào khớp (vượt mọi ngưỡng, không open-ended): work_unit=0.5, morning_absent=true", () => {
    const r = resolveLatePenaltyFromTiers(LATE_TIERS, dayStart(), 500, false);
    expect(r.work_unit).toBe(0.5);
    expect(r.morning_absent).toBe(true);
  });

  test("không có tier nào trong DB: trả về base, không phạt", () => {
    const r = resolveLatePenaltyFromTiers([], dayStart(), 30, false);
    expect(r).toEqual({ work_unit: 1, penalty_amount: 0, morning_absent: false });
  });

  test("nhiều 'thế hệ' tier (effective_from khác nhau): chọn đúng thế hệ mới nhất <= ngày tính", () => {
    const oldGen: PenaltyTier[] = [
      {
        from_minutes: 1,
        to_minutes: null,
        to_count: null,
        from_count: null,
        penalty_kind: "money",
        penalty_value: 10000,
        effective_from: new Date("2019-01-01")
      }
    ];
    const newGen: PenaltyTier[] = [
      {
        from_minutes: 1,
        to_minutes: null,
        to_count: null,
        from_count: null,
        penalty_kind: "money",
        penalty_value: 99999,
        effective_from: new Date("2025-01-01")
      }
    ];
    const r = resolveLatePenaltyFromTiers([...oldGen, ...newGen], dayStart(), 5, false);
    expect(r.penalty_amount).toBe(99999); // thế hệ mới hơn (2025) thắng vì <= ngày tính (2026)
  });
});

describe("resolveForgotPenaltyFromTiers", () => {
  const FORGOT_TIERS: PenaltyTier[] = [
    {
      from_count: 1,
      to_count: 2,
      from_minutes: null,
      to_minutes: null,
      penalty_kind: "work_unit",
      penalty_value: 0,
      effective_from: EFFECTIVE_FROM
    },
    {
      from_count: 3,
      to_count: null,
      from_minutes: null,
      to_minutes: null,
      penalty_kind: "money",
      penalty_value: 100000,
      effective_from: EFFECTIVE_FROM
    }
  ];

  test("count=0: không phạt, work_unit=base", () => {
    expect(resolveForgotPenaltyFromTiers(FORGOT_TIERS, dayStart(), 0, false)).toEqual({
      work_unit: 1,
      penalty_amount: 0
    });
  });

  test("count=1 (tier work_unit): work_unit=base/2, không phạt tiền", () => {
    const r = resolveForgotPenaltyFromTiers(FORGOT_TIERS, dayStart(), 1, false);
    expect(r.work_unit).toBe(0.5);
    expect(r.penalty_amount).toBe(0);
  });

  test("count=3 (tier money): work_unit=base, phạt tiền", () => {
    const r = resolveForgotPenaltyFromTiers(FORGOT_TIERS, dayStart(), 3, false);
    expect(r.work_unit).toBe(1);
    expect(r.penalty_amount).toBe(100000);
  });
});

// Port nguyên từ __tests__/forgotOccurrenceMap.test.js (task 1.8.3.3) — hàm thuần, chỉ đổi vị trí.
describe("buildUnifiedForgotOccurrenceMap", () => {
  test("gộp đơn đã duyệt + ngày tự động phát hiện theo đúng thứ tự ngày", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [{ date: new Date("2026-07-10T01:00:00.000Z") }],
      daySnapshots: [
        {
          dateKey: "2026-07-03",
          hasIn: true,
          hasOut: false,
          leaveMorning: false,
          leaveAfternoon: false
        },
        {
          dateKey: "2026-07-07",
          hasIn: false,
          hasOut: true,
          leaveMorning: false,
          leaveAfternoon: false
        },
        {
          dateKey: "2026-07-10",
          hasIn: true,
          hasOut: true,
          leaveMorning: false,
          leaveAfternoon: false
        }
      ]
    });

    expect(occMap.get("2026-07-03")).toEqual({ occurrence: 1, hasRequest: false });
    expect(occMap.get("2026-07-07")).toEqual({ occurrence: 2, hasRequest: false });
    expect(occMap.get("2026-07-10")).toEqual({ occurrence: 3, hasRequest: true });
  });

  test("ngày có đơn đã duyệt không bị đếm lại thành auto dù đủ 2 chiều hay thiếu 1 chiều", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [{ date: new Date("2026-07-05T01:00:00.000Z") }],
      daySnapshots: [
        {
          dateKey: "2026-07-05",
          hasIn: true,
          hasOut: false,
          leaveMorning: false,
          leaveAfternoon: false
        }
      ]
    });
    expect(occMap.size).toBe(1);
    expect(occMap.get("2026-07-05")).toEqual({ occurrence: 1, hasRequest: true });
  });

  test("ngày đủ cả 2 chiều (không thiếu gì) không được tính vào auto", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [],
      daySnapshots: [
        {
          dateKey: "2026-07-01",
          hasIn: true,
          hasOut: true,
          leaveMorning: false,
          leaveAfternoon: false
        }
      ]
    });
    expect(occMap.size).toBe(0);
  });

  test("chiều thiếu được nghỉ phép che phủ: không tính là quên chấm công", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [],
      daySnapshots: [
        {
          dateKey: "2026-07-01",
          hasIn: true,
          hasOut: false,
          leaveMorning: false,
          leaveAfternoon: true
        }
      ]
    });
    expect(occMap.size).toBe(0);
  });

  test("ngày vắng cả 2 chiều (không leave) vẫn không tính vào auto (không phải partial)", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [],
      daySnapshots: [
        {
          dateKey: "2026-07-01",
          hasIn: false,
          hasOut: false,
          leaveMorning: false,
          leaveAfternoon: false
        }
      ]
    });
    expect(occMap.size).toBe(0);
  });

  test("input rỗng/không truyền -> map rỗng", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({});
    expect(occMap.size).toBe(0);
  });
});

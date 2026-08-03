import moment from "moment-timezone";
import { resolveLeaveConflict } from "../../../src/modules/timesheet/domain/resolve-leave-conflict";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4
const SATURDAY_KEY = "2026-07-04"; // thứ 7

const at = (dateKey: string, hhmm: string) =>
  moment.tz(`${dateKey} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();

describe("resolveLeaveConflict", () => {
  test("thiếu check-in hoặc check-out: không xử lý gì", () => {
    expect(
      resolveLeaveConflict({
        dateKey: DATE_KEY,
        checkInTime: null,
        checkOutTime: at(DATE_KEY, "17:00"),
        lastShiftEnd: "17:30",
        leaveStatuses: [
          { id: "a", period: "full", status: "leave_paid", date: at(DATE_KEY, "00:00") }
        ]
      })
    ).toEqual({ overriddenStatusIds: [], refundAmount: 0 });
  });

  test("không có leave status nào trong ngày: không xử lý gì", () => {
    expect(
      resolveLeaveConflict({
        dateKey: DATE_KEY,
        checkInTime: at(DATE_KEY, "08:00"),
        checkOutTime: at(DATE_KEY, "17:00"),
        lastShiftEnd: "17:30",
        leaveStatuses: []
      })
    ).toEqual({ overriddenStatusIds: [], refundAmount: 0 });
  });

  test("chỉ có check-in, thiếu check-out: không xử lý gì (guard cần CẢ 2)", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "08:00"),
      checkOutTime: null,
      lastShiftEnd: null,
      leaveStatuses: [
        { id: "morning-1", period: "morning", status: "leave_paid", date: at(DATE_KEY, "00:00") }
      ]
    });
    expect(result).toEqual({ overriddenStatusIds: [], refundAmount: 0 });
  });

  test("có đủ check-in (trước 12h) + check-out: đè leave_paid buổi sáng, hoàn 0.5", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "08:00"),
      checkOutTime: at(DATE_KEY, "12:30"), // không cần cover afternoon để test riêng morning
      lastShiftEnd: null, // không có lastShiftEnd -> coversAfternoon luôn false
      leaveStatuses: [
        { id: "morning-1", period: "morning", status: "leave_paid", date: at(DATE_KEY, "00:00") }
      ]
    });
    expect(result.overriddenStatusIds).toEqual(["morning-1"]);
    expect(result.refundAmount).toBe(0.5);
  });

  test("check-in sau 12h -> KHÔNG đè leave_paid buổi sáng", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "13:00"),
      checkOutTime: at(DATE_KEY, "17:00"),
      lastShiftEnd: "17:30",
      leaveStatuses: [
        { id: "morning-1", period: "morning", status: "leave_paid", date: at(DATE_KEY, "00:00") }
      ]
    });
    expect(result).toEqual({ overriddenStatusIds: [], refundAmount: 0 });
  });

  test("check-out trong vòng 60 phút trước giờ tan ca -> đè leave_paid buổi chiều, hoàn 0.5", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "13:00"), // sau 12h -> không cover morning
      checkOutTime: at(DATE_KEY, "17:00"), // 17:30 - 60p = 16:30, 17:00 >= 16:30 -> cover afternoon
      lastShiftEnd: "17:30",
      leaveStatuses: [
        {
          id: "afternoon-1",
          period: "afternoon",
          status: "leave_paid",
          date: at(DATE_KEY, "00:00")
        }
      ]
    });
    expect(result.overriddenStatusIds).toEqual(["afternoon-1"]);
    expect(result.refundAmount).toBe(0.5);
  });

  test("check-out quá sớm (trước ngưỡng 60 phút) -> KHÔNG đè leave_paid buổi chiều", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "13:00"),
      checkOutTime: at(DATE_KEY, "16:00"), // 16:00 < 16:30 threshold
      lastShiftEnd: "17:30",
      leaveStatuses: [
        {
          id: "afternoon-1",
          period: "afternoon",
          status: "leave_paid",
          date: at(DATE_KEY, "00:00")
        }
      ]
    });
    expect(result).toEqual({ overriddenStatusIds: [], refundAmount: 0 });
  });

  test("check-in + check-out phủ cả 2 buổi -> đè leave_paid 'full', hoàn nguyên 1 ngày (không phải thứ 7)", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "08:00"),
      checkOutTime: at(DATE_KEY, "17:00"),
      lastShiftEnd: "17:30",
      leaveStatuses: [
        { id: "full-1", period: "full", status: "leave_paid", date: at(DATE_KEY, "00:00") }
      ]
    });
    expect(result.overriddenStatusIds).toEqual(["full-1"]);
    expect(result.refundAmount).toBe(1);
  });

  test("'full' nhưng chỉ phủ 1 buổi -> KHÔNG đè (isCoveredBy yêu cầu cả 2 buổi cho period full)", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "08:00"),
      checkOutTime: at(DATE_KEY, "12:30"),
      lastShiftEnd: null,
      leaveStatuses: [
        { id: "full-1", period: "full", status: "leave_paid", date: at(DATE_KEY, "00:00") }
      ]
    });
    expect(result).toEqual({ overriddenStatusIds: [], refundAmount: 0 });
  });

  test("leave_unpaid bị đè: KHÔNG hoàn phép (chỉ leave_paid mới hoàn)", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "08:00"),
      checkOutTime: at(DATE_KEY, "12:30"),
      lastShiftEnd: null,
      leaveStatuses: [
        { id: "morning-1", period: "morning", status: "leave_unpaid", date: at(DATE_KEY, "00:00") }
      ]
    });
    expect(result.overriddenStatusIds).toEqual(["morning-1"]);
    expect(result.refundAmount).toBe(0);
  });

  test("thứ 7, leave_paid 'full' bị đè: hoàn 0.5 (không phải 1, vì thứ 7 chỉ nửa công)", () => {
    const result = resolveLeaveConflict({
      dateKey: SATURDAY_KEY,
      checkInTime: at(SATURDAY_KEY, "08:00"),
      checkOutTime: at(SATURDAY_KEY, "12:00"),
      lastShiftEnd: "12:00",
      leaveStatuses: [
        { id: "full-1", period: "full", status: "leave_paid", date: at(SATURDAY_KEY, "00:00") }
      ]
    });
    expect(result.overriddenStatusIds).toEqual(["full-1"]);
    expect(result.refundAmount).toBe(0.5);
  });

  test("nhiều leave status cùng lúc, cộng dồn refund đúng", () => {
    const result = resolveLeaveConflict({
      dateKey: DATE_KEY,
      checkInTime: at(DATE_KEY, "08:00"),
      checkOutTime: at(DATE_KEY, "17:00"),
      lastShiftEnd: "17:30",
      leaveStatuses: [
        { id: "morning-1", period: "morning", status: "leave_paid", date: at(DATE_KEY, "00:00") },
        {
          id: "afternoon-1",
          period: "afternoon",
          status: "leave_paid",
          date: at(DATE_KEY, "00:00")
        }
      ]
    });
    expect(result.overriddenStatusIds.sort()).toEqual(["afternoon-1", "morning-1"]);
    expect(result.refundAmount).toBe(1); // 0.5 + 0.5
  });
});

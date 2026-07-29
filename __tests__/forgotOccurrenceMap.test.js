const { buildUnifiedForgotOccurrenceMap } = require("../src/helpers/attendancePenalty");

describe("buildUnifiedForgotOccurrenceMap", () => {
  test("gộp đơn đã duyệt + ngày tự động phát hiện theo đúng thứ tự ngày", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [{ date: new Date("2026-07-10T01:00:00.000Z") }],
      daySnapshots: [
        { dateKey: "2026-07-03", hasIn: true, hasOut: false, leaveMorning: false, leaveAfternoon: false },
        { dateKey: "2026-07-07", hasIn: false, hasOut: true, leaveMorning: false, leaveAfternoon: false },
        { dateKey: "2026-07-10", hasIn: true, hasOut: true, leaveMorning: false, leaveAfternoon: false }
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
        { dateKey: "2026-07-05", hasIn: true, hasOut: false, leaveMorning: false, leaveAfternoon: false }
      ]
    });
    expect(occMap.size).toBe(1);
    expect(occMap.get("2026-07-05")).toEqual({ occurrence: 1, hasRequest: true });
  });

  test("ngày đủ cả 2 chiều (không thiếu gì) không được tính vào auto", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [],
      daySnapshots: [
        { dateKey: "2026-07-01", hasIn: true, hasOut: true, leaveMorning: false, leaveAfternoon: false }
      ]
    });
    expect(occMap.size).toBe(0);
  });

  test("chiều thiếu được nghỉ phép che phủ: không tính là quên chấm công", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [],
      daySnapshots: [
        { dateKey: "2026-07-01", hasIn: true, hasOut: false, leaveMorning: false, leaveAfternoon: true }
      ]
    });
    expect(occMap.size).toBe(0);
  });

  test("ngày vắng cả 2 chiều (không leave) vẫn không tính vào auto (không phải partial)", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({
      approvedForgotRequests: [],
      daySnapshots: [
        { dateKey: "2026-07-01", hasIn: false, hasOut: false, leaveMorning: false, leaveAfternoon: false }
      ]
    });
    expect(occMap.size).toBe(0);
  });

  test("input rỗng/không truyền -> map rỗng", () => {
    const occMap = buildUnifiedForgotOccurrenceMap({});
    expect(occMap.size).toBe(0);
  });
});

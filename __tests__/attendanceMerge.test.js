const moment = require("moment-timezone");
const { resolveAttendanceDay } = require("../src/helpers/attendanceHelper");

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4, không phải thứ 7

const at = (hhmm) => moment.tz(`${DATE_KEY} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();

const stubLatePenalty = () => ({ work_unit: 1, penalty_amount: 0, morning_absent: false });
const stubEarlyPenalty = () => ({ work_unit: 1, penalty_amount: 0, afternoon_absent: false });
const stubForgotPenalty = () => ({ work_unit: 1, penalty_amount: 0 });

const makeArgs = ({ worksheet = {}, ...overrides } = {}) => ({
  dateKey: DATE_KEY,
  rawIn: null,
  rawOut: null,
  worksheet: {
    check_in: null,
    check_out: null,
    minutes_late: 0,
    work_unit: null,
    penalty_amount: 0,
    shifts: [{ start_time: "08:00", end_time: "17:30" }],
    ...worksheet
  },
  forgotMap: new Map(),
  forgotOccurrenceMap: new Map(),
  lateForgivenSet: new Set(),
  earlyForgivenSet: new Set(),
  leavePeriodsMap: new Map(),
  resolveLatePenalty: stubLatePenalty,
  resolveEarlyPenalty: stubEarlyPenalty,
  resolveForgotPenalty: stubForgotPenalty,
  ...overrides
});

describe("resolveAttendanceDay — merge máy chấm công vs app", () => {
  test("cả 2 nguồn: lấy checkin sớm nhất, checkout muộn nhất (máy sớm hơn / app muộn hơn)", () => {
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "07:58",
        rawOut: "17:00",
        worksheet: { check_in: at("08:05"), check_out: at("17:35") }
      })
    );
    expect(result.skip).toBe(false);
    expect(result.newCheckIn).toEqual(at("07:58"));
    expect(result.newCheckOut).toEqual(at("17:35"));
  });

  test("cả 2 nguồn: chiều ngược lại (app sớm hơn / máy muộn hơn)", () => {
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "08:10",
        rawOut: "17:40",
        worksheet: { check_in: at("08:05"), check_out: at("17:20") }
      })
    );
    expect(result.newCheckIn).toEqual(at("08:05"));
    expect(result.newCheckOut).toEqual(at("17:40"));
  });

  test("chỉ có máy chấm công: dùng giờ máy", () => {
    const result = resolveAttendanceDay(makeArgs({ rawIn: "08:01", rawOut: "17:31" }));
    expect(result.newCheckIn).toEqual(at("08:01"));
    expect(result.newCheckOut).toEqual(at("17:31"));
  });

  test("máy thiếu checkout: fallback sang giờ app", () => {
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "08:00",
        rawOut: null,
        worksheet: { check_out: at("17:31") }
      })
    );
    expect(result.newCheckIn).toEqual(at("08:00"));
    expect(result.newCheckOut).toEqual(at("17:31"));
  });

  test("đơn quên chấm công đã duyệt: giá trị worksheet thắng kết quả merge", () => {
    const forgotMap = new Map([[DATE_KEY, { type: "check_in" }]]);
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "07:00",
        rawOut: "17:30",
        worksheet: { check_in: at("08:30") },
        forgotMap
      })
    );
    expect(result.newCheckIn).toEqual(at("08:30"));
    expect(result.newCheckOut).toEqual(at("17:30"));
  });

  test("cặp giờ merge cách nhau < 120 phút: checkout bị loại", () => {
    const result = resolveAttendanceDay(
      makeArgs({
        rawOut: "09:00",
        worksheet: { check_in: at("08:00") }
      })
    );
    expect(result.newCheckIn).toEqual(at("08:00"));
    expect(result.newCheckOut).toBeNull();
    expect(result.work_unit).toBe(0);
  });

  test("giá trị merge trùng giá trị đã lưu: trả unchanged (idempotent khi re-import)", () => {
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "07:58",
        rawOut: "17:35",
        worksheet: {
          check_in: at("07:58"),
          check_out: at("17:35"),
          minutes_late: 0,
          work_unit: 1,
          penalty_amount: 0
        }
      })
    );
    expect(result.skip).toBe(true);
    expect(result.unchanged).toBe(true);
  });

  test("thiếu checkout, không có đơn nhưng có trong bộ đếm hợp nhất (hasRequest:false): work_unit = nửa công ngày thường", () => {
    const forgotOccurrenceMap = new Map([[DATE_KEY, { occurrence: 1, hasRequest: false }]]);
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "08:00",
        rawOut: null,
        worksheet: { check_in: null, check_out: null },
        forgotOccurrenceMap
      })
    );
    expect(result.work_unit).toBe(0.5);
    // Không tách present/absent theo buổi ở nhánh này -> saveAttendanceDay sẽ gán
    // "missed_clock" cho cả ngày (period "full") thay vì present cho buổi có dữ liệu.
    expect(result.morning_absent).toBe(false);
    expect(result.afternoon_absent).toBe(false);
  });

  test("thiếu checkout, không có đơn, KHÔNG có trong bộ đếm hợp nhất: giữ hành vi cũ work_unit = 0", () => {
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "08:00",
        rawOut: null,
        worksheet: { check_in: null, check_out: null }
      })
    );
    expect(result.work_unit).toBe(0);
  });

  test("thiếu checkout, có đơn (hasRequest:true) nhưng vẫn thiếu sau merge: giữ hành vi cũ work_unit = 0", () => {
    const forgotOccurrenceMap = new Map([[DATE_KEY, { occurrence: 1, hasRequest: true }]]);
    const result = resolveAttendanceDay(
      makeArgs({
        rawIn: "08:00",
        rawOut: null,
        worksheet: { check_in: null, check_out: null },
        forgotOccurrenceMap
      })
    );
    expect(result.work_unit).toBe(0);
  });

  test("Thứ 7, thiếu checkout, không có đơn nhưng có trong bộ đếm hợp nhất: work_unit = 0.25 (nửa của 0.5)", () => {
    const SATURDAY_KEY = "2026-07-04"; // thứ 7
    const forgotOccurrenceMap = new Map([[SATURDAY_KEY, { occurrence: 1, hasRequest: false }]]);
    const result = resolveAttendanceDay(
      makeArgs({
        dateKey: SATURDAY_KEY,
        rawIn: "08:00",
        rawOut: null,
        worksheet: { check_in: null, check_out: null },
        forgotOccurrenceMap
      })
    );
    expect(result.work_unit).toBe(0.25);
  });
});

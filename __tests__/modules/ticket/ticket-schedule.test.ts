import { WorkingCalendar } from "../../../src/shared-kernel/working-calendar";
import {
  computeReopenUntil,
  computeSchedule,
  DEFAULT_TICKET_CALENDAR_CONFIG,
  DEFAULT_TICKET_SCHEDULE_POLICY,
  isYellow,
  ScheduleInput
} from "../../../src/modules/ticket/domain/ticket-schedule";

const calendar = new WorkingCalendar({ ...DEFAULT_TICKET_CALENDAR_CONFIG, holidays: [] });
const policy = DEFAULT_TICKET_SCHEDULE_POLICY;

// 2026-10-23 là thứ Sáu
const vn = (value: string) => new Date(`${value}+07:00`);

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    status: "open",
    urgency: "normal",
    lastActivityAt: vn("2026-10-23T09:00:00"),
    statusChangedAt: vn("2026-10-23T09:00:00"),
    dueHintAt: null,
    hold: null,
    followUp: null,
    reminderSentAt: null,
    assignment: { ownerId: null },
    ...overrides
  };
}

describe("computeSchedule — cảnh báo vàng", () => {
  it("open: vàng khi chưa ai nhận quá ngưỡng (bình thường = 1 ngày làm việc)", () => {
    const schedule = computeSchedule(input(), policy, calendar);
    expect(schedule.alertReason).toBe("unclaimed");
    // T6 09:00 + 540 phút = hết ca T6 (17:00=480') … còn 60' → sáng T7 09:00
    expect(schedule.alertAt).toEqual(vn("2026-10-24T09:00:00"));
  });

  it("open + Khẩn: ngưỡng 1 giờ làm việc", () => {
    const schedule = computeSchedule(input({ urgency: "urgent" }), policy, calendar);
    expect(schedule.alertAt).toEqual(vn("2026-10-23T10:00:00"));
  });

  it("open tạo tối thứ Sáu: đồng hồ chỉ chạy từ đầu giờ làm việc kế tiếp", () => {
    const schedule = computeSchedule(
      input({ urgency: "urgent", statusChangedAt: vn("2026-10-23T20:00:00") }),
      policy,
      calendar
    );
    expect(schedule.alertAt).toEqual(vn("2026-10-24T09:00:00"));
  });

  it("in_progress: vàng khi im lặng quá ngưỡng", () => {
    const schedule = computeSchedule(
      input({ status: "in_progress", assignment: { ownerId: "a" } }),
      policy,
      calendar
    );
    expect(schedule.alertReason).toBe("silent");
    // 3 ngày làm việc = 1620 phút từ T6 09:00: T6 480', T7 240' (720'), T2 540' (1260'), 360' sang T3 → 14:00
    expect(schedule.alertAt).toEqual(vn("2026-10-27T14:00:00"));
  });

  it("in_progress đã tự hẹn ngày: không vàng vì im lặng, chỉ vàng khi qua hết ngày hẹn", () => {
    const schedule = computeSchedule(
      input({
        status: "in_progress",
        assignment: { ownerId: "a" },
        dueHintAt: vn("2026-10-30T00:00:00")
      }),
      policy,
      calendar
    );
    expect(schedule.alertReason).toBe("overdue");
    expect(schedule.alertAt).toEqual(vn("2026-10-31T00:00:00"));
  });

  it("on_hold có ngày dự kiến tiếp tục: vàng khi qua ngày đó", () => {
    const resumeAt = vn("2026-11-05T00:00:00");
    const schedule = computeSchedule(
      input({ status: "on_hold", hold: { reason: "Chờ dev", resumeAt } }),
      policy,
      calendar
    );
    expect(schedule).toMatchObject({ alertAt: resumeAt, alertReason: "overdue" });
  });

  it("on_hold chưa xác định ngày: vàng sau 5 ngày làm việc không cập nhật", () => {
    const schedule = computeSchedule(
      input({ status: "on_hold", hold: { reason: "Chờ ngân hàng", resumeAt: null } }),
      policy,
      calendar
    );
    expect(schedule.alertReason).toBe("hold_unknown");
    expect(schedule.alertAt!.getTime()).toBeGreaterThan(vn("2026-10-28T09:00:00").getTime());
  });

  it("waiting_info / resolved / đã kết thúc không có cảnh báo vàng", () => {
    ["waiting_info", "resolved", "closed", "cancelled"].forEach((status) => {
      const schedule = computeSchedule(input({ status: status as any }), policy, calendar);
      expect(schedule.alertAt).toBeNull();
      expect(schedule.alertReason).toBeNull();
    });
  });
});

describe("computeSchedule — tự đóng và nhắc", () => {
  it("resolved: tự đóng sau 3 ngày làm việc tính bằng giờ làm việc (bỏ chiều T7, CN)", () => {
    const schedule = computeSchedule(
      input({ status: "resolved", statusChangedAt: vn("2026-10-23T16:00:00") }),
      policy,
      calendar
    );
    // 1620' từ T6 16:00: T6 60', T7 240' (300'), T2 540' (840'), T3 540' (1380'), 240' sang T4 → 12:00
    expect(schedule.autoCloseAt).toEqual(vn("2026-10-28T12:00:00"));
    expect(schedule.remindAt).toBeNull();
  });

  it("resolved có 'cần theo dõi thêm': không tự đóng trước ngày kiểm tra, và nhắc đúng ngày kiểm tra", () => {
    const checkAt = vn("2026-11-10T09:00:00");
    const schedule = computeSchedule(
      input({
        status: "resolved",
        statusChangedAt: vn("2026-10-23T16:00:00"),
        followUp: { note: "Xem kỳ lãi sau", checkAt }
      }),
      policy,
      calendar
    );
    expect(schedule.autoCloseAt!.getTime()).toBeGreaterThan(checkAt.getTime());
    expect(schedule.remindAt).toEqual(checkAt);
  });

  it("đã nhắc rồi thì không nhắc lại", () => {
    const schedule = computeSchedule(
      input({
        status: "resolved",
        followUp: { note: "x", checkAt: vn("2026-11-10T09:00:00") },
        reminderSentAt: vn("2026-11-10T09:05:00")
      }),
      policy,
      calendar
    );
    expect(schedule.remindAt).toBeNull();
  });

  it("waiting_info: tự đóng sau 3 ngày làm việc, nhắc 1 lần trước 1 ngày", () => {
    const schedule = computeSchedule(
      input({ status: "waiting_info", statusChangedAt: vn("2026-10-26T09:00:00") }),
      policy,
      calendar
    );
    // T2 09:00 + 1620': T2 480' → T3 540' (1020') → T4 540' (1560') → 60' sang T5 → 09:00 T5
    expect(schedule.autoCloseAt).toEqual(vn("2026-10-29T09:00:00"));
    // nhắc sau 2 ngày làm việc (1080'): T2 480' + T3 540' = 1020', còn 60' sang T4 → 09:00 T4
    expect(schedule.remindAt).toEqual(vn("2026-10-28T09:00:00"));
  });
});

describe("computeReopenUntil", () => {
  it("hạn mở lại = 3 ngày làm việc kể từ lúc đóng", () => {
    expect(computeReopenUntil(vn("2026-10-23T16:00:00"), policy, calendar)).toEqual(
      vn("2026-10-28T12:00:00")
    );
  });
});

describe("isYellow", () => {
  const alertAt = vn("2026-10-23T12:00:00");

  it("chỉ vàng khi còn xử lý dở và đã quá mốc cảnh báo", () => {
    expect(isYellow({ status: "open", alertAt }, vn("2026-10-23T13:00:00"))).toBe(true);
    expect(isYellow({ status: "open", alertAt }, vn("2026-10-23T11:00:00"))).toBe(false);
    expect(isYellow({ status: "closed", alertAt }, vn("2026-10-23T13:00:00"))).toBe(false);
    expect(isYellow({ status: "open", alertAt: null }, vn("2026-10-23T13:00:00"))).toBe(false);
  });
});

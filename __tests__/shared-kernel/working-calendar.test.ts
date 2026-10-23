import { WorkingCalendar, toVnDateKey } from "../../src/shared-kernel/working-calendar";

// Lịch của ticket: T2–T6 08:00–17:00, T7 chỉ buổi sáng 08:00–12:00, nghỉ CN và ngày lễ.
const SATURDAY_MORNING = { 6: { startMinute: 8 * 60, endMinute: 12 * 60 } };

function vn(value: string): Date {
  return new Date(`${value}+07:00`);
}

describe("WorkingCalendar — khung giờ riêng theo thứ (dayWindows)", () => {
  const calendar = new WorkingCalendar({
    workDays: [1, 2, 3, 4, 5, 6],
    dayWindows: SATURDAY_MORNING,
    holidays: ["2026-11-07"] // thứ Bảy nghỉ lễ
  });

  // 2026-10-23 là thứ Sáu; 24 = T7; 25 = CN; 26 = T2
  it("T7 chỉ tính trong giờ làm buổi sáng", () => {
    expect(calendar.isWorkingTime(vn("2026-10-24T08:00:00"))).toBe(true);
    expect(calendar.isWorkingTime(vn("2026-10-24T11:59:00"))).toBe(true);
    expect(calendar.isWorkingTime(vn("2026-10-24T12:00:00"))).toBe(false);
    expect(calendar.isWorkingTime(vn("2026-10-24T14:00:00"))).toBe(false);
  });

  it("T2–T6 vẫn theo ca hành chính mặc định", () => {
    expect(calendar.isWorkingTime(vn("2026-10-23T16:59:00"))).toBe(true);
    expect(calendar.isWorkingTime(vn("2026-10-23T17:00:00"))).toBe(false);
  });

  it("Chủ nhật và ngày lễ (kể cả T7) là ngày nghỉ", () => {
    expect(calendar.isWorkingDay(vn("2026-10-25T10:00:00"))).toBe(false);
    expect(calendar.isWorkingDay(vn("2026-11-07T10:00:00"))).toBe(false);
  });

  it("nextWorkingStart: chiều T7 → sáng T2", () => {
    expect(calendar.nextWorkingStart(vn("2026-10-24T13:00:00"))).toEqual(
      vn("2026-10-26T08:00:00")
    );
  });

  it("nextWorkingStart: chiều T6 → sáng T7", () => {
    expect(calendar.nextWorkingStart(vn("2026-10-23T18:00:00"))).toEqual(
      vn("2026-10-24T08:00:00")
    );
  });

  it("nextWorkingStart bỏ qua T7 nghỉ lễ", () => {
    expect(calendar.nextWorkingStart(vn("2026-11-06T18:00:00"))).toEqual(
      vn("2026-11-09T08:00:00")
    );
  });

  it("addWorkingMinutes: 3 ngày làm việc (3 × 540 phút — ca hành chính 08:00–17:00) từ 16:00 thứ Sáu → 12:00 thứ Tư", () => {
    // T6: 60' + T7 sáng: 240' + T2: 540' + T3: 540' = 1380' → còn 240' sang T4 08:00 → 12:00
    expect(calendar.addWorkingMinutes(vn("2026-10-23T16:00:00"), 3 * 540)).toEqual(
      vn("2026-10-28T12:00:00")
    );
  });

  it("addWorkingMinutes dừng đúng cuối buổi sáng T7", () => {
    expect(calendar.addWorkingMinutes(vn("2026-10-23T16:00:00"), 300)).toEqual(
      vn("2026-10-24T12:00:00")
    );
  });

  it("workingMinutesBetween: T6 16:00 → T2 09:00 = 60 + 240 + 60", () => {
    expect(
      calendar.workingMinutesBetween(vn("2026-10-23T16:00:00"), vn("2026-10-26T09:00:00"))
    ).toBe(360);
  });

  it("khung giờ T7 không hợp lệ (kết thúc <= bắt đầu) bị từ chối", () => {
    expect(
      () =>
        new WorkingCalendar({
          workDays: [6],
          dayWindows: { 6: { startMinute: 720, endMinute: 480 } }
        })
    ).toThrow();
  });

  it("không khai báo dayWindows thì giữ hành vi cũ (mọi ngày làm cùng khung giờ)", () => {
    const legacy = new WorkingCalendar();
    expect(legacy.isWorkingTime(vn("2026-10-24T10:00:00"))).toBe(false); // T7 không nằm trong workDays
    expect(legacy.addWorkingMinutes(vn("2026-10-23T16:00:00"), 120)).toEqual(
      vn("2026-10-26T09:00:00")
    );
  });

  it("toVnDateKey theo giờ VN", () => {
    expect(toVnDateKey(vn("2026-10-24T00:30:00"))).toBe("2026-10-24");
  });
});

import { DateKey } from "../../src/shared-kernel/date-key";
import { ArgumentInvalidException } from "../../src/core/exceptions/exceptions";

describe("DateKey", () => {
  it("from() chuyển Date sang đúng format YYYY-MM-DD theo timezone hệ thống (Asia/Ho_Chi_Minh)", () => {
    // 2026-01-05T20:00:00Z = 2026-01-06 03:00 giờ VN (+7) — xác nhận dùng đúng timezone, không phải UTC
    const date = new Date("2026-01-05T20:00:00Z");
    expect(DateKey.from(date).toString()).toBe("2026-01-06");
  });

  it("from() chấp nhận string ISO", () => {
    expect(DateKey.from("2026-03-15").toString()).toBe("2026-03-15");
  });

  it("of() dựng trực tiếp từ chuỗi YYYY-MM-DD hợp lệ", () => {
    expect(DateKey.of("2026-12-31").toString()).toBe("2026-12-31");
  });

  it("equals() so sánh theo giá trị", () => {
    const a = DateKey.of("2026-01-01");
    const b = DateKey.from(new Date("2025-12-31T17:00:00Z")); // = 2026-01-01 giờ VN
    expect(a.equals(b)).toBe(true);
  });

  it("throw khi format sai", () => {
    expect(() => DateKey.of("31/12/2026")).toThrow(ArgumentInvalidException);
    expect(() => DateKey.of("2026-1-1")).toThrow(ArgumentInvalidException);
  });

  it("toDate() trả về Date bắt đầu ngày theo đúng timezone hệ thống — không nhận tham số tz", () => {
    // Cố tình KHÔNG cho toDate() nhận tham số timezone (xem comment trong date-key.ts): nếu from()
    // và toDate() nhận 2 tz khác nhau, cùng 1 DateKey sẽ âm thầm đại diện cho 2 instant khác nhau mà
    // không có cảnh báo gì. Toàn hệ thống chỉ có 1 timezone thật (verify: 22 file hardcode giống hệt
    // "Asia/Ho_Chi_Minh") nên DateKey tự sở hữu hằng số này, loại bỏ hẳn khả năng truyền lệch.
    const key = DateKey.of("2026-01-06");
    const date = key.toDate();
    expect(date.toISOString()).toBe("2026-01-05T17:00:00.000Z"); // 00:00 giờ VN = 17:00 UTC hôm trước
  });
});

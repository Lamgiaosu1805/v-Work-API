import {
  calculateDistanceMeters,
  isWithinRadius
} from "../../../src/modules/attendance/domain/geofence";

describe("calculateDistanceMeters", () => {
  test("2 điểm trùng nhau: khoảng cách = 0", () => {
    const p = { latitude: 21.0285, longitude: 105.8542 };
    expect(calculateDistanceMeters(p, p)).toBe(0);
  });

  test("2 điểm cách nhau khoảng ~111km (1 độ vĩ độ): xấp xỉ đúng", () => {
    const a = { latitude: 21.0, longitude: 105.0 };
    const b = { latitude: 22.0, longitude: 105.0 };
    const distance = calculateDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(110000);
    expect(distance).toBeLessThan(112000);
  });
});

describe("isWithinRadius", () => {
  const center = { latitude: 21.0285, longitude: 105.8542 };

  test("điểm trùng tâm, radius bất kỳ >= 0: trong phạm vi", () => {
    expect(isWithinRadius(center, center, 0)).toBe(true);
  });

  test("điểm cách tâm xa hơn radius: ngoài phạm vi", () => {
    const far = { latitude: 21.5, longitude: 105.8542 };
    expect(isWithinRadius(far, center, 100)).toBe(false);
  });

  test("khoảng cách đúng bằng radius: coi là trong phạm vi (<=, khớp điều kiện gốc `distance > radius` mới báo lỗi)", () => {
    const other = { latitude: 21.0286, longitude: 105.8542 };
    const distance = calculateDistanceMeters(other, center);
    expect(isWithinRadius(other, center, distance)).toBe(true);
  });
});

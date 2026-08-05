import { Period } from "../../src/shared-kernel/period";
import { ArgumentInvalidException } from "../../src/core/exceptions/exceptions";

describe("Period", () => {
  it("of()/toString() roundtrip đúng 3 giá trị hợp lệ", () => {
    expect(Period.of("morning").toString()).toBe("morning");
    expect(Period.of("afternoon").toString()).toBe("afternoon");
    expect(Period.of("full").toString()).toBe("full");
  });

  it("throw khi giá trị không hợp lệ", () => {
    expect(() => Period.of("evening")).toThrow(ArgumentInvalidException);
  });

  describe("includesMorning() / includesAfternoon()", () => {
    it("morning chỉ include morning", () => {
      expect(Period.of("morning").includesMorning()).toBe(true);
      expect(Period.of("morning").includesAfternoon()).toBe(false);
    });
    it("afternoon chỉ include afternoon", () => {
      expect(Period.of("afternoon").includesMorning()).toBe(false);
      expect(Period.of("afternoon").includesAfternoon()).toBe(true);
    });
    it("full include cả 2", () => {
      expect(Period.of("full").includesMorning()).toBe(true);
      expect(Period.of("full").includesAfternoon()).toBe(true);
    });
  });

  // Đúng bảng chân trị của resolveLeaveConflictOnAttendance (leaveHandler.js, hiện tại):
  // shouldOverride = (period==="morning" && coversMorning) || (period==="afternoon" && coversAfternoon)
  //                || (period==="full" && coversMorning && coversAfternoon)
  describe("isCoveredBy() — khớp đúng luật resolveLeaveConflictOnAttendance hiện tại", () => {
    it.each([
      ["morning", true, false, true],
      ["morning", false, true, false],
      ["morning", false, false, false],
      ["afternoon", false, true, true],
      ["afternoon", true, false, false],
      ["full", true, true, true],
      ["full", true, false, false],
      ["full", false, true, false],
      ["full", false, false, false]
    ])(
      "period=%s coversMorning=%s coversAfternoon=%s -> %s",
      (period, coversMorning, coversAfternoon, expected) => {
        expect(
          Period.of(period as string).isCoveredBy(
            coversMorning as boolean,
            coversAfternoon as boolean
          )
        ).toBe(expected);
      }
    );
  });
});

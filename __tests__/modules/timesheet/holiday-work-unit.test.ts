import {
  buildHolidayDefaultWorkUnitMap,
  HolidaySnapshot
} from "../../../src/modules/timesheet/domain/holiday-work-unit";

describe("buildHolidayDefaultWorkUnitMap", () => {
  test("ngày lễ paid, thứ 4 (weekday): work_unit mặc định = 1", () => {
    const holidays: HolidaySnapshot[] = [
      {
        date: new Date("2026-09-02T00:00:00+07:00"),
        pay_policy: "paid",
        scope_type: "all",
        branches: []
      }
    ];
    const map = buildHolidayDefaultWorkUnitMap(holidays, null);
    expect(map.get("2026-09-02")).toBe(1);
  });

  test("ngày lễ paid rơi vào thứ 7: work_unit mặc định = 0.5 (khớp quy ước nửa công)", () => {
    const holidays: HolidaySnapshot[] = [
      {
        date: new Date("2026-09-05T00:00:00+07:00"),
        pay_policy: "paid",
        scope_type: "all",
        branches: []
      } // thứ 7
    ];
    const map = buildHolidayDefaultWorkUnitMap(holidays, null);
    expect(map.get("2026-09-05")).toBe(0.5);
  });

  test("ngày lễ rơi vào Chủ nhật: không có default (Chủ nhật vốn không phải ngày công chuẩn)", () => {
    const holidays: HolidaySnapshot[] = [
      {
        date: new Date("2026-09-06T00:00:00+07:00"),
        pay_policy: "paid",
        scope_type: "all",
        branches: []
      } // CN
    ];
    const map = buildHolidayDefaultWorkUnitMap(holidays, null);
    expect(map.has("2026-09-06")).toBe(false);
  });

  test("ngày lễ pay_policy=unpaid: không có default", () => {
    const holidays: HolidaySnapshot[] = [
      {
        date: new Date("2026-09-02T00:00:00+07:00"),
        pay_policy: "unpaid",
        scope_type: "all",
        branches: []
      }
    ];
    const map = buildHolidayDefaultWorkUnitMap(holidays, null);
    expect(map.has("2026-09-02")).toBe(false);
  });

  test("scope_type=branch, branchId không khớp: không có default", () => {
    const holidays: HolidaySnapshot[] = [
      {
        date: new Date("2026-09-02T00:00:00+07:00"),
        pay_policy: "paid",
        scope_type: "branch",
        branches: ["branch-a"]
      }
    ];
    const map = buildHolidayDefaultWorkUnitMap(holidays, "branch-b");
    expect(map.has("2026-09-02")).toBe(false);
  });

  test("scope_type=branch, branchId khớp: có default = 1", () => {
    const holidays: HolidaySnapshot[] = [
      {
        date: new Date("2026-09-02T00:00:00+07:00"),
        pay_policy: "paid",
        scope_type: "branch",
        branches: ["branch-a"]
      }
    ];
    const map = buildHolidayDefaultWorkUnitMap(holidays, "branch-a");
    expect(map.get("2026-09-02")).toBe(1);
  });

  test("input rỗng -> map rỗng", () => {
    const map = buildHolidayDefaultWorkUnitMap([], null);
    expect(map.size).toBe(0);
  });
});

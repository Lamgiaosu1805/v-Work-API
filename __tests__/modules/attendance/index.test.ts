import mongoose from "mongoose";
import xlsx from "xlsx";
import { MongoMemoryServer } from "mongodb-memory-server";
import AllowedWifiLocationModel from "../../../src/models/AllowedWifiLocationModel";
import ShiftModel from "../../../src/models/ShiftModel";
import {
  checkWifiLocation,
  calculateMinutesLate,
  calculateMinutesEarly,
  hasShiftEnded,
  listAllowedWifiLocations,
  createAllowedWifiLocation,
  deleteAllowedWifiLocation,
  listShifts,
  createShift,
  parseExcelToBlocks,
  parseDayRows
} from "../../../src/modules/attendance"; // eslint-disable-line import/no-duplicates
// Verify encapsulation: repository nội bộ KHÔNG được export qua public API — nếu lỡ export nhầm, dòng
// ts-expect-error ngay dưới sẽ tự báo lỗi "unused directive" khi build (đúng pattern đã dùng ở
// modules/timesheet/index.ts, task 1.8.3.5).
// @ts-expect-error - AllowedWifiLocationRepository là chi tiết nội bộ, không export qua index.ts
import { AllowedWifiLocationRepository } from "../../../src/modules/attendance"; // eslint-disable-line import/no-duplicates, @typescript-eslint/no-unused-vars

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await AllowedWifiLocationModel.deleteMany({});
  await ShiftModel.deleteMany({});
});

describe("modules/attendance public API", () => {
  // recordCheckIn/recordCheckOut không còn thuộc modules/attendance từ task 1.8.5.4 — orchestration
  // xuyên module đã chuyển sang workflows/ (xem __tests__/workflows/). checkWifiLocation + 3 domain
  // function dưới đây mới export thêm ở 1.8.5.1, cho workflows/ dùng.
  test("checkWifiLocation + domain function được export đúng dạng hàm", () => {
    expect(typeof checkWifiLocation).toBe("function");
    expect(typeof calculateMinutesLate).toBe("function");
    expect(typeof calculateMinutesEarly).toBe("function");
    expect(typeof hasShiftEnded).toBe("function");
  });

  test("CRUD wifi qua public API: tạo -> list -> xoá -> không còn trong list", async () => {
    const created = await createAllowedWifiLocation({
      ssid: "SSID-A",
      latitude: 21,
      longitude: 105
    });
    expect((await listAllowedWifiLocations()).map((d) => d.ssid)).toEqual(["SSID-A"]);

    await deleteAllowedWifiLocation(created._id.toString());
    expect(await listAllowedWifiLocations()).toEqual([]);
  });

  test("CRUD shift qua public API: tạo -> xuất hiện trong list", async () => {
    await createShift({ name: "Ca hành chính", start_time: "08:00", end_time: "17:30" });
    const shifts = await listShifts();
    expect(shifts.map((s) => s.name)).toEqual(["Ca hành chính"]);
  });

  test("parseExcelToBlocks + parseDayRows qua public API: parse đúng 1 block/1 ngày", () => {
    const aoa = [
      ["Mã nhân viên: M001", "", "", "", "", "", "", ""],
      ["01/07/2026", "", "08:01", "", "", "", "", "17:31"]
    ];
    const ws = xlsx.utils.aoa_to_sheet(aoa);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const blocks = parseExcelToBlocks(buffer);
    expect(blocks).toHaveLength(1);
    const rows = parseDayRows(blocks[0]);
    expect(rows).toEqual([{ dateStr: "01/07/2026", rawIn: "08:01", rawOut: "17:31" }]);
  });
});

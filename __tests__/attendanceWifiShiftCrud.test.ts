import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import AllowedWifiLocationModel from "../src/models/AllowedWifiLocationModel";
import ShiftModel from "../src/models/ShiftModel";

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

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

// Characterization test cho cutover task 1.8.4.11 — 5 hàm CRUD wifi/shift chưa từng có test qua
// Express thật trước đây (logic nghiệp vụ đã test đầy đủ ở manage-wifi-location/manage-shift.service.test.ts,
// 1.8.4.9). Ở đây chỉ verify wiring: req/res thật + sendExceptionResponse map đúng status/message.
describe("AttendanceController — CRUD wifi (cutover 1.8.4.11)", () => {
  test("getAllowedWifiLocations: trả đúng danh sách", async () => {
    await AllowedWifiLocationModel.create({ ssid: "SSID-A", latitude: 21, longitude: 105 });
    const res = makeRes();

    await AttendanceController.getAllowedWifiLocations({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Lấy danh sách điểm chấm công thành công",
        data: expect.arrayContaining([expect.objectContaining({ ssid: "SSID-A" })])
      })
    );
  });

  test("createAllowedWifiLocation: SSID trùng -> 400 qua sendExceptionResponse", async () => {
    await AllowedWifiLocationModel.create({ ssid: "SSID-A", latitude: 21, longitude: 105 });
    const req = { body: { ssid: "SSID-A", latitude: 21, longitude: 105 } };
    const res = makeRes();

    await AttendanceController.createAllowedWifiLocation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'SSID "SSID-A" đã tồn tại' });
  });

  test("createAllowedWifiLocation: thành công -> 200, data đúng", async () => {
    const req = { body: { ssid: "SSID-B", latitude: 21, longitude: 105 } };
    const res = makeRes();

    await AttendanceController.createAllowedWifiLocation(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Tạo điểm chấm công thành công",
        data: expect.objectContaining({ ssid: "SSID-B", radius: 100 })
      })
    );
  });

  test("deleteAllowedWifiLocation: không tồn tại -> 404 qua sendExceptionResponse", async () => {
    const req = { params: { id: new mongoose.Types.ObjectId().toString() } };
    const res = makeRes();

    await AttendanceController.deleteAllowedWifiLocation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Không tìm thấy điểm chấm công" });
  });

  test("deleteAllowedWifiLocation: thành công -> soft delete", async () => {
    const doc = await AllowedWifiLocationModel.create({
      ssid: "SSID-A",
      latitude: 21,
      longitude: 105
    });
    const req = { params: { id: doc._id.toString() } };
    const res = makeRes();

    await AttendanceController.deleteAllowedWifiLocation(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: "Xóa điểm chấm công thành công" });
    const updated: any = await AllowedWifiLocationModel.findById(doc._id).lean();
    expect(updated?.isDeleted).toBe(true);
  });
});

describe("AttendanceController — CRUD shift (cutover 1.8.4.11)", () => {
  test("createShift: tên trùng -> 400 qua sendExceptionResponse", async () => {
    await ShiftModel.create({ name: "Ca sáng", start_time: "08:00", end_time: "12:00" });
    const req = { body: { name: "Ca sáng", start_time: "08:00", end_time: "12:00" } };
    const res = makeRes();

    await AttendanceController.createShift(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Shift Ca sáng đã tồn tại" });
  });

  test("createShift: thành công -> 201, data đúng", async () => {
    const req = { body: { name: "Ca sáng", start_time: "08:00", end_time: "12:00" } };
    const res = makeRes();

    await AttendanceController.createShift(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Tạo ca làm việc thành công",
        data: expect.objectContaining({ name: "Ca sáng", late_allowance_minutes: 0 })
      })
    );
  });

  test("getAllShifts: trả đúng danh sách", async () => {
    await ShiftModel.create({ name: "Ca sáng", start_time: "08:00", end_time: "12:00" });
    const res = makeRes();

    await AttendanceController.getAllShifts({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Lấy danh sách ca làm việc thành công",
        data: expect.arrayContaining([expect.objectContaining({ name: "Ca sáng" })])
      })
    );
  });
});

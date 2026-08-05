import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AllowedWifiLocationModel from "../../../src/models/AllowedWifiLocationModel";
import { AllowedWifiLocationRepository } from "../../../src/modules/attendance/infrastructure/allowed-wifi-location.repository";

let mongod: MongoMemoryServer;
const repository = new AllowedWifiLocationRepository();

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
});

describe("AllowedWifiLocationRepository", () => {
  test("findActive: chỉ trả điểm chưa xoá, sắp xếp mới nhất trước", async () => {
    await AllowedWifiLocationModel.create({
      name: "A",
      ssid: "WIFI-A",
      latitude: 21,
      longitude: 105
    });
    await new Promise((r) => {
      setTimeout(r, 5);
    });
    await AllowedWifiLocationModel.create({
      name: "B",
      ssid: "WIFI-B",
      latitude: 21,
      longitude: 105
    });
    await AllowedWifiLocationModel.create({
      name: "C-deleted",
      ssid: "WIFI-C",
      latitude: 21,
      longitude: 105,
      isDeleted: true
    });

    const list = await repository.findActive();
    expect(list.map((l) => l.ssid)).toEqual(["WIFI-B", "WIFI-A"]);
  });

  test("findBySsid: tìm đúng theo ssid, bỏ qua đã xoá", async () => {
    await AllowedWifiLocationModel.create({
      name: "A",
      ssid: "WIFI-A",
      latitude: 21,
      longitude: 105
    });
    const found = await repository.findBySsid("WIFI-A");
    expect(found?.ssid).toBe("WIFI-A");
    expect(await repository.findBySsid("WIFI-NOT-EXIST")).toBeNull();
  });

  test("create: mặc định radius=100 nếu không truyền", async () => {
    const doc = await repository.create({ ssid: "WIFI-X", latitude: 21, longitude: 105 });
    expect(doc.radius).toBe(100);
    expect(doc.name).toBe("");
  });

  test("create: dùng radius truyền vào nếu có", async () => {
    const doc = await repository.create({
      ssid: "WIFI-Y",
      latitude: 21,
      longitude: 105,
      radius: 50
    });
    expect(doc.radius).toBe(50);
  });

  test("softDelete: đánh dấu isDeleted, findActive không còn thấy", async () => {
    const doc = await repository.create({ ssid: "WIFI-Z", latitude: 21, longitude: 105 });
    const deleted = await repository.softDelete(doc._id.toString());
    expect(deleted?.ssid).toBe("WIFI-Z");
    expect(await repository.findBySsid("WIFI-Z")).toBeNull();
  });

  test("softDelete: id không tồn tại -> trả null", async () => {
    const result = await repository.softDelete(new mongoose.Types.ObjectId().toString());
    expect(result).toBeNull();
  });
});

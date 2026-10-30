import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import TicketSettingModel from "../../../src/models/TicketSettingModel";
import { TicketConfigService } from "../../../src/modules/ticket/application/ticket-config.service";
import { loadTicketSettings } from "../../../src/modules/ticket/infrastructure/ticket-settings";

// Cập nhật một phần ngưỡng cảnh báo vàng: các mức không gửi phải GIỮ NGUYÊN giá trị đang lưu,
// không rơi về mặc định.

let mongod: MongoMemoryServer;
const service = new TicketConfigService({} as any);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await TicketSettingModel.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await TicketSettingModel.deleteMany({});
});

describe("TicketConfigService.updateSettings — cập nhật một phần ngưỡng", () => {
  it("chỉ gửi mức 'normal' thì các mức khác của nhóm giữ nguyên giá trị đã tuỳ chỉnh", async () => {
    await service.updateSettings({
      unclaimedMinutes: { urgent: 30, high: 60, normal: 120, low: 240 }
    });

    await service.updateSettings({ unclaimedMinutes: { normal: 200 } });

    const { policy } = await loadTicketSettings();
    expect(policy.unclaimedMinutes).toEqual({ urgent: 30, high: 60, normal: 200, low: 240 });

    // Document lưu đủ 4 mức (không chỉ phần vừa gửi)
    const doc = await TicketSettingModel.findOne({ key: "default" }).lean();
    expect(doc?.unclaimed_minutes).toMatchObject({ urgent: 30, high: 60, normal: 200, low: 240 });
  });

  it("nhóm im lặng cũng gộp đủ; sửa nhóm này không đụng nhóm kia", async () => {
    await service.updateSettings({
      unclaimedMinutes: { urgent: 30, high: 60, normal: 120, low: 240 },
      silentMinutes: { urgent: 100, high: 200, normal: 300, low: 400 }
    });

    await service.updateSettings({ silentMinutes: { urgent: 50 } });

    const { policy } = await loadTicketSettings();
    expect(policy.silentMinutes).toEqual({ urgent: 50, high: 200, normal: 300, low: 400 });
    expect(policy.unclaimedMinutes).toEqual({ urgent: 30, high: 60, normal: 120, low: 240 });
  });

  it("lần đầu (chưa có document) chỉ gửi một mức thì các mức còn lại là mặc định, được lưu rõ ràng", async () => {
    await service.updateSettings({ unclaimedMinutes: { urgent: 10 } });

    const { policy } = await loadTicketSettings();
    expect(policy.unclaimedMinutes.urgent).toBe(10);
    const doc = await TicketSettingModel.findOne({ key: "default" }).lean();
    expect(Object.keys(doc?.unclaimed_minutes ?? {}).sort()).toEqual(
      ["high", "low", "normal", "urgent"].sort()
    );
  });

  it("kiểm tra thứ tự chạy trên giá trị đã gộp: không được vượt mức khác đã lưu", async () => {
    await service.updateSettings({
      unclaimedMinutes: { urgent: 30, high: 60, normal: 120, low: 240 }
    });

    // 'urgent' = 100 > 'high' = 60 đã lưu → từ chối, và không ghi gì
    await expect(service.updateSettings({ unclaimedMinutes: { urgent: 100 } })).rejects.toThrow();

    const { policy } = await loadTicketSettings();
    expect(policy.unclaimedMinutes).toEqual({ urgent: 30, high: 60, normal: 120, low: 240 });
  });
});

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AppModel from "../../../src/models/AppModel";
import CustomerModel from "../../../src/models/CustomerModel";
import {
  canOpenEmployeeProfile,
  customerProfileTarget
} from "../../../src/modules/ticket/interface/ticket-profile-access";

// Link ở chi tiết ticket phải dẫn tới đúng nơi và chỉ hiện khi người xem thật sự mở được hồ sơ:
// khách TIKLUY → trang chi tiết; khách app khác (VNFITE) → danh sách khách của app đó; không có hồ sơ CRM hoặc
// ngoài phạm vi dữ liệu của người xem → không có link.

let mongod: MongoMemoryServer;
let tikluyId: mongoose.Types.ObjectId;
let vnfiteId: mongoose.Types.ObjectId;

// Ability giả: chỉ cho xem khách có SĐT nằm trong danh sách được phép (mô phỏng phạm vi "khách của mình")
const abilityAllowing = (phones: string[]) =>
  ({
    can: (_action: string, subject: any) =>
      typeof subject === "string" ? true : phones.includes(String(subject?.phone_number))
  }) as any;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const [tikluy, vnfite] = await AppModel.create([
    { name: "TikLuy", code: "tikluy" },
    { name: "VNFITE", code: "vnfite" }
  ]);
  tikluyId = tikluy._id as mongoose.Types.ObjectId;
  vnfiteId = vnfite._id as mongoose.Types.ObjectId;
  await CustomerModel.create([
    { app_id: tikluyId, phone_number: "0911000001", external_id: "uuid-tikluy-1" },
    { app_id: vnfiteId, phone_number: "0922000002", external_id: "uuid-vnfite-2" }
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("customerProfileTarget", () => {
  it("khách TIKLUY → trang chi tiết", async () => {
    const target = await customerProfileTarget(abilityAllowing(["0911000001"]), {
      externalId: "uuid-tikluy-1",
      appCode: "tikluy"
    });
    expect(target).toBe("detail");
  });

  it("khách VNFITE → danh sách khách của app (chưa có trang chi tiết)", async () => {
    const target = await customerProfileTarget(abilityAllowing(["0922000002"]), {
      externalId: "uuid-vnfite-2",
      appCode: "vnfite"
    });
    expect(target).toBe("list");
  });

  it("tìm đúng khách theo customerId, không theo mã trùng ở app khác", async () => {
    const doc: any = await CustomerModel.findOne({ external_id: "uuid-vnfite-2" }).lean();
    const target = await customerProfileTarget(abilityAllowing(["0922000002"]), {
      customerId: String(doc._id),
      externalId: "uuid-tikluy-1", // sai app: customerId được ưu tiên
      appCode: "tikluy"
    });
    expect(target).toBe("list");
  });

  it("khách ngoài phạm vi dữ liệu của người xem → không có link", async () => {
    const target = await customerProfileTarget(abilityAllowing(["0922000002"]), {
      externalId: "uuid-tikluy-1",
      appCode: "tikluy"
    });
    expect(target).toBeNull();
  });

  it("khách nhập tay (không có hồ sơ CRM) hoặc không có quyền → không có link", async () => {
    expect(
      await customerProfileTarget(abilityAllowing(["0911000001"]), {
        externalId: "khong-ton-tai",
        appCode: "tikluy"
      })
    ).toBeNull();
    expect(await customerProfileTarget(undefined, { externalId: "uuid-tikluy-1" })).toBeNull();
    expect(await customerProfileTarget(abilityAllowing([]), null)).toBeNull();
  });
});

describe("canOpenEmployeeProfile", () => {
  it("không có quyền employee.view → không mở được", async () => {
    const ability = { can: () => false } as any;
    expect(await canOpenEmployeeProfile(ability, String(new mongoose.Types.ObjectId()))).toBe(
      false
    );
    expect(await canOpenEmployeeProfile(undefined, String(new mongoose.Types.ObjectId()))).toBe(
      false
    );
  });
});

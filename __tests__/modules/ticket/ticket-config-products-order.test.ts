import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import TicketProductModel from "../../../src/models/TicketProductModel";
import { TicketConfigService } from "../../../src/modules/ticket/application/ticket-config.service";
import {
  ArgumentInvalidException,
  ConflictException
} from "../../../src/core/exceptions/exceptions";

// Kéo thả đổi thứ tự sản phẩm hỗ trợ: lưu thứ tự, giữ cùng nhóm liền nhau, sản phẩm mới xuống cuối nhóm.

let mongod: MongoMemoryServer;
const service = new TicketConfigService({} as any);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await TicketProductModel.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await TicketProductModel.deleteMany({});
});

// Tạo lần lượt (cách nhau vài ms để ngày tạo khác nhau) và trả về map code → id
async function seed(items: Array<[code: string, group: string]>) {
  const ids: Record<string, string> = {};
  for (const [code, group] of items) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await TicketProductModel.create({ code, name: code.toUpperCase(), group });
    ids[code] = String(doc._id);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  return ids;
}

const codes = async () => (await service.list("products")).map((item: any) => item.code);

describe("TicketConfigService.reorderProducts", () => {
  it("lưu thứ tự mới và danh sách trả về đúng thứ tự đó", async () => {
    const id = await seed([
      ["v_app", "VNFITE"],
      ["v_cms", "VNFITE"],
      ["t_app", "TIKLUY"],
      ["crm", "vWork"]
    ]);
    expect(await codes()).toEqual(["v_app", "v_cms", "t_app", "crm"]);

    const result = await service.reorderProducts([id.crm, id.t_app, id.v_cms, id.v_app]);

    expect(result.map((item: any) => item.code)).toEqual(["crm", "t_app", "v_cms", "v_app"]);
    expect(await codes()).toEqual(["crm", "t_app", "v_cms", "v_app"]);
    const stored = await TicketProductModel.find({}).sort({ sort_order: 1 }).lean();
    expect(stored.map((doc: any) => doc.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("sản phẩm đang tắt cũng nằm trong danh sách phải gửi lên", async () => {
    const id = await seed([
      ["a", "G"],
      ["b", "G"]
    ]);
    await TicketProductModel.updateOne({ _id: id.b }, { $set: { is_active: false } });

    await service.reorderProducts([id.b, id.a]);

    expect(await codes()).toEqual(["b", "a"]);
  });

  it("từ chối khi một nhóm bị tách rời", async () => {
    const id = await seed([
      ["v_app", "VNFITE"],
      ["v_cms", "VNFITE"],
      ["t_app", "TIKLUY"]
    ]);

    await expect(service.reorderProducts([id.v_app, id.t_app, id.v_cms])).rejects.toBeInstanceOf(
      ArgumentInvalidException
    );
    expect(await codes()).toEqual(["v_app", "v_cms", "t_app"]);
  });

  it("từ chối id sai định dạng, trùng, hoặc không phải mảng", async () => {
    const id = await seed([["a", "G"]]);

    await expect(service.reorderProducts("nope")).rejects.toBeInstanceOf(ArgumentInvalidException);
    await expect(service.reorderProducts(["không-phải-id"])).rejects.toBeInstanceOf(
      ArgumentInvalidException
    );
    await expect(service.reorderProducts([id.a, id.a])).rejects.toBeInstanceOf(
      ArgumentInvalidException
    );
  });

  it("danh sách cũ (thiếu hoặc thừa sản phẩm) bị từ chối 409, không ghi gì", async () => {
    const id = await seed([
      ["a", "G"],
      ["b", "G"]
    ]);

    await expect(service.reorderProducts([id.a])).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reorderProducts([id.a, id.b, String(new mongoose.Types.ObjectId())])
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await TicketProductModel.countDocuments({ sort_order: { $type: "number" } })).toBe(0);
  });

  it("sản phẩm đã xoá không tính vào danh sách", async () => {
    const id = await seed([
      ["a", "G"],
      ["b", "G"]
    ]);
    await service.remove("products", id.b);

    await service.reorderProducts([id.a]);

    expect(await codes()).toEqual(["a"]);
  });
});

describe("thứ tự sản phẩm khi tạo / đổi nhóm", () => {
  it("chưa ai kéo thả thì sản phẩm mới không có thứ tự, vẫn xếp theo ngày tạo", async () => {
    await seed([["a", "G"]]);

    const created = (await service.create("products", { code: "b", name: "B", group: "G" })) as any;

    expect(created.sortOrder).toBeNull();
    expect(await codes()).toEqual(["a", "b"]);
  });

  it("sau khi đã sắp xếp, sản phẩm mới xuống cuối nhóm của nó, nhóm mới xuống cuối bảng", async () => {
    const id = await seed([
      ["v_app", "VNFITE"],
      ["t_app", "TIKLUY"]
    ]);
    await service.reorderProducts([id.t_app, id.v_app]);

    await service.create("products", { code: "v_cms", name: "V CMS", group: "VNFITE" });
    await service.create("products", { code: "x_app", name: "X APP", group: "X" });

    expect(await codes()).toEqual(["t_app", "v_app", "v_cms", "x_app"]);
  });

  it("đổi nhóm thì sản phẩm sang cuối nhóm mới; sửa tên không đổi vị trí", async () => {
    const id = await seed([
      ["a", "G1"],
      ["b", "G1"],
      ["c", "G2"]
    ]);
    await service.reorderProducts([id.a, id.b, id.c]);

    await service.update("products", id.a, { name: "A đổi tên" });
    expect(await codes()).toEqual(["a", "b", "c"]);

    await service.update("products", id.a, { group: "G2" });
    expect(await codes()).toEqual(["b", "c", "a"]);
  });
});

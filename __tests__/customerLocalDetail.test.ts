// Gọi kho file của app nguồn qua axios: mock để không cần mạng; tikluyClient dùng axios.create nên mock cả create
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import FecLeadModel from "../src/models/FecLeadModel";

jest.mock("axios", () => ({
  get: jest.fn(),
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } }
  }))
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerController = require("../src/controllers/CustomerController");

let mongod: MongoMemoryServer;
let abilityOfSaleA: unknown;
let vnfiteAppId: mongoose.Types.ObjectId;

const makeRes = () => {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(body: any) {
      this.body = body;
      return this;
    }
  };
  return res;
};

const call = async (query: Record<string, unknown>) => {
  const res = makeRes();
  await CustomerController.getLocalDetail({ query, permissionAbility: abilityOfSaleA }, res);
  return res;
};

const callImage = async (query: Record<string, unknown>) => {
  const res = makeRes();
  await CustomerController.getLocalImage({ query, permissionAbility: abilityOfSaleA }, res);
  return res;
};

async function createSale(username: string, maNv: string) {
  const account = await AccountModel.create({ username, password: "x" });
  return UserInfoModel.create({
    full_name: `Sale ${maNv}`,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000001",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const saleA = await createSale("sale_a", "A001");
  const saleB = await createSale("sale_b", "B001");

  await PermissionCatalogModel.create({
    code: "customer.view",
    module: "crm",
    name: "customer.view",
    entity: "Customer",
    actionKind: "READ",
    supportsFieldScope: false,
    validDataScopePolicies: ["CUSTOMER_SELF_ASSIGNED"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CUSTOMER_SELF_ASSIGNED",
    entity: "Customer",
    label: "Khách do mình phụ trách",
    conditionTree: {
      operator: "AND",
      clauses: [
        {
          left: "resource.referred_by",
          operator: "EQ",
          right: { type: "SUBJECT_REF", path: "subject.userId" }
        }
      ]
    }
  });
  const role = await PermissionRoleModel.create({
    name: "Local detail test",
    code: "LOCAL_DETAIL_TEST",
    grants: [{ permissionCode: "customer.view", dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED" }]
  });
  await EmployeePermissionProfileModel.create({
    employeeId: saleA._id,
    roleIds: [role._id],
    overrides: []
  });
  abilityOfSaleA = await resolveEffectiveAbility(String(saleA._id));

  const vnfite = await AppModel.create({ name: "VNFITE", code: "vnfite" });
  const tikluy = await AppModel.create({ name: "TikLuy", code: "tikluy" });
  vnfiteAppId = vnfite._id;

  const mine = await CustomerModel.create({
    app_id: vnfite._id,
    phone_number: "0911111111",
    external_id: "u-mine",
    status: "kyc_verified",
    referred_by: saleA._id,
    source_type: "sale",
    identity: {
      full_name: "Nguyen Van A",
      id_number: "001234567890",
      gender: "male",
      id_front_url: "front-id",
      selfie_url: "selfie-id"
    }
  });
  await CustomerModel.create({
    app_id: vnfite._id,
    phone_number: "0922222222",
    external_id: "u-other",
    referred_by: saleB._id,
    source_type: "sale"
  });
  await CustomerModel.create({
    app_id: vnfite._id,
    phone_number: "0944444444",
    external_id: "u-badimg",
    referred_by: saleA._id,
    source_type: "sale",
    identity: { full_name: "Anh Loi", id_front_url: "front-ok", id_back_url: "../secret/passwd" }
  });
  await CustomerModel.create({
    app_id: tikluy._id,
    phone_number: "0933333333",
    external_id: "u-tikluy",
    referred_by: saleA._id,
    source_type: "sale"
  });

  await FecLeadModel.create({
    app_code: "vnfite",
    partner: "FEC",
    customer_id: mine._id,
    customer_external_id: "u-mine",
    lead_gen_id: "LEAD-1",
    trans_id: "T-1",
    lead_status: "OK",
    lead_created_at: new Date(),
    stage: "IN_PROGRESS",
    version: 2,
    last_event_at: new Date(),
    last_event_id: "evt-1",
    offer_amt: 50000000,
    history: [
      {
        callback_id: "cb-1",
        status: "X",
        received_at: new Date()
      }
    ]
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("CustomerController.getLocalDetail", () => {
  it("trả hồ sơ, sale, FEC lead của khách thuộc phạm vi và không lộ ảnh/history", async () => {
    const res = await call({ app_code: "vnfite", external_id: "u-mine" });

    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    expect(data.phone_number).toBe("0911111111");
    expect(data.identity.full_name).toBe("Nguyen Van A");
    expect(data.identity.id_number).toBe("001234567890");
    expect(data.identity.has_id_front).toBe(true);
    expect(data.identity.has_id_back).toBe(false);
    expect(data.identity.has_selfie).toBe(true);
    expect(data.identity.id_front_url).toBeUndefined();
    expect(data.sale.ma_nv).toBe("A001");
    // Chỉ trả số lượng lead, danh sách xem ở menu Khách FE Credit
    expect(data.fec_leads).toBeUndefined();
    expect(data.stats.fec_lead_count).toBe(1);
  });

  it("403 khi khách thuộc Sale khác (ngoài phạm vi quyền)", async () => {
    const res = await call({ app_code: "vnfite", external_id: "u-other" });
    expect(res.statusCode).toBe(403);
  });

  it("không trả khách của app khác dù trùng external_id", async () => {
    const res = await call({ app_code: "vnfite", external_id: "u-tikluy" });
    expect(res.statusCode).toBe(404);
    // Trả mã app thật của khách để màn hình gợi ý chuyển công ty
    expect(res.body.app_code).toBe("tikluy");
  });

  it("404 không kèm app_code khi không có khách nào mang mã này", async () => {
    const res = await call({ app_code: "vnfite", external_id: "khong-ton-tai" });
    expect(res.statusCode).toBe(404);
    expect(res.body.app_code).toBeNull();
  });

  it("400 khi tham số không phải chuỗi (chặn NoSQL injection)", async () => {
    const res = await call({ app_code: "vnfite", external_id: { $ne: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("404 khi app không tồn tại", async () => {
    const res = await call({ app_code: "khong-co", external_id: "u-mine" });
    expect(res.statusCode).toBe(404);
    expect(vnfiteAppId).toBeDefined();
  });
});

describe("CustomerController.getLocalImage", () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const axiosGet = require("axios").get as jest.Mock;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

  beforeEach(() => {
    axiosGet.mockReset();
    // Các nhánh lỗi cố ý ghi console.error ở server; tắt cho log test gọn
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("trả ảnh theo mã lưu trong hồ sơ khách, không cho trình duyệt lưu lại", async () => {
    axiosGet.mockResolvedValue({ data: jpeg, headers: { "content-type": "image/jpeg" } });

    const res = await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "front" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(Buffer.from(res.body)).toEqual(jpeg);
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(axiosGet.mock.calls[0][0]).toBe(
      "https://service.vnfite.com.vn/file-manager/v2/file/front-id"
    );
  });

  it("chân dung dùng đúng mã selfie", async () => {
    axiosGet.mockResolvedValue({ data: jpeg, headers: { "content-type": "image/png" } });
    await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "selfie" });
    expect(axiosGet.mock.calls[0][0]).toContain("/file/selfie-id");
  });

  it("khách của Sale khác bị 403 và không gọi kho file", async () => {
    const res = await callImage({ app_code: "vnfite", external_id: "u-other", kind: "front" });
    expect(res.statusCode).toBe(403);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("loại ảnh sai hoặc không phải chuỗi thì 400", async () => {
    expect(
      (await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "x" })).statusCode
    ).toBe(400);
    expect(
      (await callImage({ app_code: "vnfite", external_id: { $ne: "x" }, kind: "front" })).statusCode
    ).toBe(400);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("app chưa hỗ trợ xem ảnh thì 400", async () => {
    const res = await callImage({ app_code: "tikluy", external_id: "u-tikluy", kind: "front" });
    expect(res.statusCode).toBe(400);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("khách chưa có ảnh đó thì 404", async () => {
    const res = await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "back" });
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Khách chưa có ảnh này");
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("mã ảnh có ký tự lạ (../) bị từ chối, không gọi kho file", async () => {
    const res = await callImage({ app_code: "vnfite", external_id: "u-badimg", kind: "back" });
    expect(res.statusCode).toBe(404);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("kho file trả tệp không phải ảnh thì 404", async () => {
    axiosGet.mockResolvedValue({
      data: Buffer.from("{}"),
      headers: { "content-type": "application/json" }
    });
    const res = await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "front" });
    expect(res.statusCode).toBe(404);
  });

  it("kho file lỗi thì 502, không lộ chi tiết lỗi cho client", async () => {
    axiosGet.mockRejectedValue({ code: "ECONNABORTED", message: "secret-internal-host timeout" });
    const res = await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "front" });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret-internal-host");
  });

  it("kho file báo không có ảnh thì 404", async () => {
    axiosGet.mockRejectedValue({ response: { status: 404 }, message: "Not Found" });
    const res = await callImage({ app_code: "vnfite", external_id: "u-mine", kind: "front" });
    expect(res.statusCode).toBe(404);
  });
});

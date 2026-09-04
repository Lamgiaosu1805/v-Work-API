import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { assignExtensionOutboundHotline } from "../src/modules/customer-call/application/assign-extension-outbound-hotline.service";
import { OmicallClient, HotlineItem } from "../src/utils/omicallClient";
import { NotFoundException } from "../src/core/exceptions/exceptions";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function createSale(username: string, fullName: string, maNv: string) {
  const account = await AccountModel.create({ username, password: "x" });
  const userInfo = await UserInfoModel.create({
    full_name: fullName,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
  return { account, employeeId: String(userInfo._id) };
}

function baseHotlineItem(overrides: Partial<HotlineItem> = {}): HotlineItem {
  return {
    number: "19001234",
    status: "active",
    expire_date: null,
    created_date: Date.now(),
    last_updated_date: Date.now(),
    configs: {
      allow_call_in: true,
      allow_call_out: true,
      default_script: null,
      working_days: [],
      special_days: [],
      call_configs: null,
      access_type: "applies_according_to_employee_criteria",
      number_type: "fixed",
      disable_by_time_frame: false,
      outbound_config: null
    },
    accesses: [],
    ...overrides
  };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    SaleOmicallProfileModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

describe("assignExtensionOutboundHotline (integration, MongoMemoryServer + mock OmicallClient)", () => {
  test("employee chưa có SaleOmicallProfile -> NotFoundException, không gọi Omicall", async () => {
    const sale = await createSale("assignA", "Assign A", "NV-ASSIGN-A");
    const detailSpy = jest.spyOn(OmicallClient.prototype, "getHotlineByPhone");
    const updateSpy = jest.spyOn(OmicallClient.prototype, "updateHotlineConfig");

    await expect(assignExtensionOutboundHotline(sale.employeeId, "19001234")).rejects.toThrow(
      NotFoundException
    );

    expect(detailSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("hotline access_type = applies_to_all_employees -> no-op, không gọi updateHotlineConfig", async () => {
    const sale = await createSale("assignB", "Assign B", "NV-ASSIGN-B");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "b@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getHotlineByPhone").mockResolvedValue(
      baseHotlineItem({
        configs: { ...baseHotlineItem().configs, access_type: "applies_to_all_employees" }
      })
    );
    const updateSpy = jest
      .spyOn(OmicallClient.prototype, "updateHotlineConfig")
      .mockResolvedValue(true);

    await assignExtensionOutboundHotline(sale.employeeId, "19001234");

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("sipUser đã có sẵn trong accesses -> no-op, không gọi updateHotlineConfig", async () => {
    const sale = await createSale("assignC", "Assign C", "NV-ASSIGN-C");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "202",
      sip_password: "pass",
      omicall_email: "c@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getHotlineByPhone").mockResolvedValue(
      baseHotlineItem({
        accesses: [{ id: "acc-1", type: "Extension", name: "202" }]
      })
    );
    const updateSpy = jest
      .spyOn(OmicallClient.prototype, "updateHotlineConfig")
      .mockResolvedValue(true);

    await assignExtensionOutboundHotline(sale.employeeId, "19001234");

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("sipUser chưa có -> gọi updateHotlineConfig, merge extensions cũ + mới, giữ nguyên allowCallIn/Out/callScript", async () => {
    const sale = await createSale("assignD", "Assign D", "NV-ASSIGN-D");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "303",
      sip_password: "pass",
      omicall_email: "d@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getHotlineByPhone").mockResolvedValue(
      baseHotlineItem({
        configs: {
          ...baseHotlineItem().configs,
          allow_call_in: false,
          allow_call_out: true,
          default_script: "script-9"
        },
        accesses: [{ id: "acc-1", type: "Extension", name: "999" }]
      })
    );
    const updateSpy = jest
      .spyOn(OmicallClient.prototype, "updateHotlineConfig")
      .mockResolvedValue(true);

    await assignExtensionOutboundHotline(sale.employeeId, "19001234");

    expect(updateSpy).toHaveBeenCalledWith({
      hotline: "19001234",
      allow_call_in: "false",
      allow_call_out: "true",
      access_type: "applies_according_to_employee_criteria",
      call_script: "script-9",
      extensions: ["999", "303"]
    });
  });

  test("hotline không tồn tại -> NotFoundException bubble từ getHotlineDetail", async () => {
    const sale = await createSale("assignE", "Assign E", "NV-ASSIGN-E");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "404",
      sip_password: "pass",
      omicall_email: "e@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getHotlineByPhone").mockResolvedValue(null);

    await expect(assignExtensionOutboundHotline(sale.employeeId, "00000000")).rejects.toThrow(
      NotFoundException
    );
  });
});

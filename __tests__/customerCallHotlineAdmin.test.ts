import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getHotlineDetail } from "../src/modules/customer-call/application/get-hotline-detail.service";
import { updateHotlineConfig } from "../src/modules/customer-call/application/update-hotline-config.service";
import { listHotlineExtensions } from "../src/modules/customer-call/application/list-hotline-extensions.service";
import { OmicallClient, HotlineItem, ListInternalPhonesResult } from "../src/utils/omicallClient";
import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../src/core/exceptions/exceptions";
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
      access_type: "applies_to_all_employees",
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

describe("getHotlineDetail (unit, mock OmicallClient)", () => {
  test("Omicall trả về hotline -> resolve đúng dữ liệu", async () => {
    const item = baseHotlineItem();
    jest.spyOn(OmicallClient.prototype, "getHotlineByPhone").mockResolvedValue(item);

    const result = await getHotlineDetail("19001234");
    expect(result).toEqual(item);
  });

  test("Omicall trả về null (không tìm thấy) -> NotFoundException", async () => {
    jest.spyOn(OmicallClient.prototype, "getHotlineByPhone").mockResolvedValue(null);

    await expect(getHotlineDetail("0000000")).rejects.toThrow(NotFoundException);
  });
});

describe("updateHotlineConfig (unit, mock OmicallClient)", () => {
  test("accessType hợp lệ (toàn bộ NV) -> gọi Omicall đúng payload, allow_call_in/out là chuỗi", async () => {
    const spy = jest.spyOn(OmicallClient.prototype, "updateHotlineConfig").mockResolvedValue(true);

    await updateHotlineConfig("19001234", {
      allowCallIn: true,
      allowCallOut: false,
      accessType: "applies_to_all_employees",
      callScript: "script-1"
    });

    expect(spy).toHaveBeenCalledWith({
      hotline: "19001234",
      allow_call_in: "true",
      allow_call_out: "false",
      access_type: "applies_to_all_employees",
      call_script: "script-1"
    });
  });

  test("accessType = theo phân quyền cụ thể nhưng KHÔNG có extensions/groupIds -> ArgumentInvalidException, không gọi Omicall", async () => {
    const spy = jest.spyOn(OmicallClient.prototype, "updateHotlineConfig").mockResolvedValue(true);

    await expect(
      updateHotlineConfig("19001234", {
        allowCallIn: true,
        allowCallOut: true,
        accessType: "applies_according_to_employee_criteria"
      })
    ).rejects.toThrow(ArgumentInvalidException);

    expect(spy).not.toHaveBeenCalled();
  });

  test("accessType không hợp lệ -> ArgumentInvalidException, không gọi Omicall", async () => {
    const spy = jest.spyOn(OmicallClient.prototype, "updateHotlineConfig").mockResolvedValue(true);

    await expect(
      updateHotlineConfig("19001234", {
        allowCallIn: true,
        allowCallOut: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        accessType: "invalid_type" as any
      })
    ).rejects.toThrow(ArgumentInvalidException);

    expect(spy).not.toHaveBeenCalled();
  });

  test("Omicall API lỗi -> ConflictException", async () => {
    jest
      .spyOn(OmicallClient.prototype, "updateHotlineConfig")
      .mockRejectedValue(new Error("Omicall 500"));

    await expect(
      updateHotlineConfig("19001234", {
        allowCallIn: true,
        allowCallOut: true,
        accessType: "applies_to_all_employees"
      })
    ).rejects.toThrow(ConflictException);
  });

  test("Omicall trả HTTP 200 nhưng payload=false (soft-fail) -> ConflictException, KHÔNG coi là thành công", async () => {
    jest.spyOn(OmicallClient.prototype, "updateHotlineConfig").mockResolvedValue(false);

    await expect(
      updateHotlineConfig("19001234", {
        allowCallIn: true,
        allowCallOut: true,
        accessType: "applies_to_all_employees"
      })
    ).rejects.toThrow(ConflictException);
  });
});

describe("listHotlineExtensions (integration, MongoMemoryServer)", () => {
  function baseInternalPhonesResult(
    overrides: Partial<ListInternalPhonesResult> = {}
  ): ListInternalPhonesResult {
    return {
      items: [],
      page_number: 1,
      page_size: 200,
      total_items: 0,
      total_pages: 1,
      has_next: false,
      has_previous: false,
      ...overrides
    };
  }

  test("extension khớp với SaleOmicallProfile -> trả về full_name + ma_nv của nhân viên nội bộ", async () => {
    const sale = await createSale("hotlineExtA", "Nguyen Van A", "NV-HOT-A");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "a@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "listInternalPhones").mockResolvedValue(
      baseInternalPhonesResult({
        items: [
          {
            sip_user: "101",
            full_name: "Omicall Display Name",
            agent_id: "agent-101",
            email: "a@x.com"
          }
        ]
      })
    );

    const result = await listHotlineExtensions({});

    expect(result.items).toEqual([
      {
        sip_user: "101",
        full_name: "Nguyen Van A",
        ma_nv: "NV-HOT-A",
        agent_id: "agent-101",
        email: "a@x.com"
      }
    ]);
  });

  test("extension KHÔNG khớp SaleOmicallProfile/nhân viên nào -> bị loại khỏi kết quả (không hiện email/tên thô Omicall)", async () => {
    jest.spyOn(OmicallClient.prototype, "listInternalPhones").mockResolvedValue(
      baseInternalPhonesResult({
        items: [{ sip_user: "999", full_name: "raw@omicall.email" }]
      })
    );

    const result = await listHotlineExtensions({});

    expect(result.items).toEqual([]);
  });

  test("trộn lẫn extension đã gán và chưa gán -> chỉ trả về extension đã gán", async () => {
    const sale = await createSale("hotlineExtB", "Tran Thi B", "NV-HOT-B");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "202",
      sip_password: "pass",
      omicall_email: "b@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "listInternalPhones").mockResolvedValue(
      baseInternalPhonesResult({
        items: [
          { sip_user: "202", full_name: "Omicall B" },
          { sip_user: "888", full_name: "chua-gan@omicall.email" }
        ]
      })
    );

    const result = await listHotlineExtensions({});

    expect(result.items).toEqual([
      { sip_user: "202", full_name: "Tran Thi B", ma_nv: "NV-HOT-B", agent_id: null, email: null }
    ]);
  });
});

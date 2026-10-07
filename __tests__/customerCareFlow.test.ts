import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

jest.mock("../src/services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue(null)
}));
jest.mock("../src/modules/permission", () => ({
  ...jest.requireActual("../src/modules/permission"),
  listEmployeesByRoleCodes: jest.fn()
}));

/* eslint-disable import/first */
import { listEmployeesByRoleCodes } from "../src/modules/permission";
import {
  updateCarePolicy,
  setSaleAllocationStatus,
  setSaleCaps
} from "../src/modules/customer-care";
import {
  isMinorAt,
  syncCustomerCareByCustomerId,
  isCustomerSystemAssigned
} from "../src/workflows/sync-customer-care.workflow";
import { allocateCustomerPool } from "../src/workflows/allocate-customer-pool.workflow";
import { sweepCustomerCareSla } from "../src/workflows/sweep-customer-care-sla.workflow";
import { recordCallCareActivity } from "../src/workflows/record-call-care-activity.workflow";
import { releaseUnavailableSaleCustomers } from "../src/workflows/release-unavailable-sale-customers.workflow";
import CustomerAssignmentModel from "../src/models/CustomerAssignmentModel";
import CustomerCareStateModel from "../src/models/CustomerCareStateModel";
/* eslint-enable import/first */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const InvestmentModel = require("../src/models/InvestmentModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LeaveRequest } = require("../src/models/RequestModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationService = require("../src/services/notificationService");

// 2026-10-07 là thứ Tư; mọi giờ theo giờ Việt Nam
const vn = (local: string) => new Date(`${local}:00+07:00`);

let replset: MongoMemoryReplSet;
let appId: string;
let saleA: string;
let saleB: string;
let phoneSeq = 0;

async function createSale(maNv: string) {
  const account = await AccountModel.create({ username: maNv, password: "x" });
  const info = await UserInfoModel.create({
    full_name: `Sale ${maNv}`,
    cccd: `${maNv}-cccd`,
    phone_number: `09000000${maNv.slice(-2)}`,
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
  return String(info._id);
}

async function createCustomer(
  opts: { kyc?: boolean; referredBy?: string; dateOfBirth?: Date } = {}
) {
  phoneSeq += 1;
  const customer = await CustomerModel.create({
    app_id: appId,
    phone_number: `0911${String(phoneSeq).padStart(6, "0")}`,
    external_id: `ext-${phoneSeq}`,
    status: opts.kyc ? "kyc_verified" : "registered",
    source_type: opts.referredBy ? "sale" : "marketing",
    referred_by: opts.referredBy ?? null,
    identity: opts.kyc
      ? {
          full_name: `Khách ${phoneSeq}`,
          verified_at: vn("2026-10-06T10:00"),
          date_of_birth: opts.dateOfBirth ?? new Date("1990-05-01")
        }
      : {}
  });
  return String(customer._id);
}

const activeAssignment = (customerId: string) =>
  CustomerAssignmentModel.findOne({ customer_id: customerId, status: "active" }).lean() as any;
const careState = (customerId: string) =>
  CustomerCareStateModel.findOne({ customer_id: customerId }).lean() as any;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  const app = await AppModel.create({ name: "TikLuy", code: "tikluy", is_active: true });
  appId = String(app._id);
  saleA = await createSale("NV001");
  saleB = await createSale("NV002");
  (listEmployeesByRoleCodes as jest.Mock).mockResolvedValue(
    [saleA, saleB].map((employeeId) => ({ employeeId, accountIsDeleted: false }))
  );
  await updateCarePolicy("tikluy", { enabled: true }, String(new mongoose.Types.ObjectId()));
  (notificationService.createNotification as jest.Mock).mockClear();
});

describe("Luồng chăm sóc khách TIKLUY (Quy định 183A)", () => {
  it("khách marketing vào Pool, được phân tự động trong giờ làm việc và gắn Sale phụ trách", async () => {
    const customerId = await createCustomer({ kyc: true });
    const synced = await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T08:59"));
    expect(synced).toMatchObject({ action: "created", poolStatus: "in_pool" });
    expect((await careState(customerId)).priority_class).toBe("A");

    const outside = await allocateCustomerPool("tikluy", vn("2026-10-07T18:00"));
    expect(outside.plan).toBe("outside_working_hours");

    const run = await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    expect(run.assigned).toBe(1);
    const assignment = await activeAssignment(customerId);
    expect(assignment.channel).toBe("auto");
    expect(assignment.first_contact_due_at).toEqual(vn("2026-10-07T09:05"));
    const customer = await CustomerModel.findById(customerId).lean();
    expect(String(customer.referred_by)).toBe(String(assignment.sale_id));
    expect(customer.source_type).toBe("marketing");
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "customer_care_assigned",
        title: "Khách nóng mới — gọi ngay"
      })
    );
  });

  it("chia đều giữa các Sale và bỏ qua Sale đang nghỉ phép / bị tạm dừng", async () => {
    const c1 = await createCustomer();
    const c2 = await createCustomer();
    await syncCustomerCareByCustomerId(c1, vn("2026-10-07T08:50"));
    await syncCustomerCareByCustomerId(c2, vn("2026-10-07T08:51"));
    await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    const owners = new Set([
      String((await activeAssignment(c1)).sale_id),
      String((await activeAssignment(c2)).sale_id)
    ]);
    expect(owners).toEqual(new Set([saleA, saleB]));

    await LeaveRequest.create({
      user_id: saleA,
      status: "approved",
      from_date: vn("2026-10-08T00:00"),
      from_period: "morning",
      to_date: vn("2026-10-08T00:00"),
      to_period: "afternoon",
      total_days: 1,
      leave_type: "paid"
    });
    const c3 = await createCustomer();
    await syncCustomerCareByCustomerId(c3, vn("2026-10-08T08:30"));
    await allocateCustomerPool("tikluy", vn("2026-10-08T09:00"));
    expect(String((await activeAssignment(c3)).sale_id)).toBe(saleB);

    await setSaleAllocationStatus({
      saleId: saleB,
      status: "paused",
      reason: "Xử lý khách tồn",
      until: null,
      by: String(new mongoose.Types.ObjectId()),
      at: vn("2026-10-08T09:10"),
      defaultRank: "C"
    });
    const c4 = await createCustomer();
    await syncCustomerCareByCustomerId(c4, vn("2026-10-08T09:20"));
    const run = await allocateCustomerPool("tikluy", vn("2026-10-08T09:30"));
    expect(run.assigned).toBe(0);
    expect(run.leftInPool).toBe(1);
  });

  it("không liên hệ: cảnh báo phút 15, thu hồi phút 60 (nhóm B), phân Sale khác; vòng 2 → CSKH", async () => {
    const customerId = await createCustomer();
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T08:55"));
    await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    const first = await activeAssignment(customerId);

    expect(await sweepCustomerCareSla(vn("2026-10-07T09:10"))).toMatchObject({
      warned: 0,
      revoked: 0
    });
    expect(await sweepCustomerCareSla(vn("2026-10-07T09:15"))).toMatchObject({ warned: 1 });
    expect(await sweepCustomerCareSla(vn("2026-10-07T09:20"))).toMatchObject({ warned: 0 });
    expect(await sweepCustomerCareSla(vn("2026-10-07T10:00"))).toMatchObject({ revoked: 1 });

    const ended = await CustomerAssignmentModel.findById(first._id).lean();
    expect(ended).toMatchObject({ status: "ended", ended_reason: "revoked_no_contact" });
    expect((await CustomerModel.findById(customerId).lean()).referred_by).toBeNull();
    expect((await careState(customerId)).pool_status).toBe("in_pool");

    await allocateCustomerPool("tikluy", vn("2026-10-07T10:01"));
    const second = await activeAssignment(customerId);
    expect(String(second.sale_id)).not.toBe(String(first.sale_id));
    expect(second.round).toBe(2);

    await sweepCustomerCareSla(vn("2026-10-07T11:01"));
    const state = await careState(customerId);
    expect(state.pool_status).toBe("nurturing");
    expect(state.priority_class).toBe("C");
  });

  it("cuộc gọi tổng đài của đúng Sale được tính là liên hệ; cuộc gọi đủ dài gia hạn mốc không hoạt động", async () => {
    const customerId = await createCustomer({ kyc: true });
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T08:55"));
    await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    const assignment = await activeAssignment(customerId);
    const other = String(assignment.sale_id) === saleA ? saleB : saleA;

    const wrongSale = await recordCallCareActivity({
      saleId: other,
      customerId,
      timeStartCall: vn("2026-10-07T09:02"),
      answerSec: 120
    });
    expect(wrongSale.counted).toBe(false);

    const res = await recordCallCareActivity({
      saleId: String(assignment.sale_id),
      customerId,
      timeStartCall: vn("2026-10-07T09:03"),
      answerSec: 45
    });
    expect(res).toMatchObject({ counted: true, valid: true });
    const updated = await activeAssignment(customerId);
    expect(updated.first_contact_breached).toBe(false);
    expect(updated.inactivity_due_at).toEqual(vn("2026-10-08T09:03"));
    expect(await sweepCustomerCareSla(vn("2026-10-07T16:00"))).toMatchObject({
      warned: 0,
      revoked: 0
    });
  });

  it("eKYC giữa chừng đổi nhóm B → A; đầu tư → chuyển đổi, khách vẫn thuộc Sale", async () => {
    const customerId = await createCustomer();
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T08:55"));
    await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    const saleId = String((await activeAssignment(customerId)).sale_id);

    await CustomerModel.updateOne(
      { _id: customerId },
      { $set: { status: "kyc_verified", "identity.verified_at": vn("2026-10-07T09:10") } }
    );
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T09:10"));
    expect((await activeAssignment(customerId)).priority_class).toBe("A");

    await InvestmentModel.create({
      app_id: appId,
      customer_id: customerId,
      external_investment_id: "inv-1",
      product_name: "TikLuy 3 tháng",
      amount: 10000000,
      term_type: "month",
      term_value: 3,
      interest_rate: 7,
      invested_at: vn("2026-10-07T09:20"),
      maturity_at: vn("2027-01-07T09:20"),
      status: "active"
    });
    const result = await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T09:20"));
    expect(result).toMatchObject({ action: "converted", endedSaleId: saleId });
    expect(await activeAssignment(customerId)).toBeNull();
    expect((await careState(customerId)).pool_status).toBe("converted");
    expect(String((await CustomerModel.findById(customerId).lean()).referred_by)).toBe(saleId);
  });

  it("khách có mã Sale: lượt giao kênh referral, chỉ cảnh báo không tự thu hồi; không cho yêu cầu nhận khách", async () => {
    const customerId = await createCustomer({ referredBy: saleA });
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T09:00"));
    const assignment = await activeAssignment(customerId);
    expect(assignment).toMatchObject({ channel: "referral", auto_revoke: false });
    expect(await isCustomerSystemAssigned(customerId)).toBe(false);

    await sweepCustomerCareSla(vn("2026-10-07T09:15"));
    expect(await sweepCustomerCareSla(vn("2026-10-07T12:00"))).toMatchObject({ revoked: 0 });
    expect(await activeAssignment(customerId)).not.toBeNull();
  });

  it("màn cũ đổi Sale: đồng bộ đối soát lượt giao (gỡ Sale → về Pool; duyệt yêu cầu nhận khách → kênh claim)", async () => {
    const customerId = await createCustomer();
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T08:55"));
    await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    expect(await isCustomerSystemAssigned(customerId)).toBe(true);
    const autoSale = String((await activeAssignment(customerId)).sale_id);
    const claimer = autoSale === saleA ? saleB : saleA;

    await CustomerModel.updateOne({ _id: customerId }, { $set: { referred_by: claimer } });
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T09:30"), {
      ownerChannel: "claim"
    });
    const claimed = await activeAssignment(customerId);
    expect(claimed).toMatchObject({ channel: "claim" });
    expect(String(claimed.sale_id)).toBe(claimer);
    const old = await CustomerAssignmentModel.findOne({
      customer_id: customerId,
      sale_id: autoSale
    }).lean();
    expect((old as any).ended_reason).toBe("claimed");

    await CustomerModel.updateOne({ _id: customerId }, { $set: { referred_by: null } });
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T10:00"));
    expect(await activeAssignment(customerId)).toBeNull();
  });

  it("Sale nghỉ việc → thu hồi khách về Pool; Sale bị khoá giữ khách tự giới thiệu", async () => {
    const pooled = await createCustomer();
    await syncCustomerCareByCustomerId(pooled, vn("2026-10-07T08:55"));
    (listEmployeesByRoleCodes as jest.Mock).mockResolvedValue([
      { employeeId: saleA, accountIsDeleted: false }
    ]);
    await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    const referral = await createCustomer({ referredBy: saleA });
    await syncCustomerCareByCustomerId(referral, vn("2026-10-07T09:00"));

    await setSaleAllocationStatus({
      saleId: saleA,
      status: "locked",
      reason: "Vi phạm SLA nhiều lần",
      until: null,
      by: String(new mongoose.Types.ObjectId()),
      at: vn("2026-10-07T10:00"),
      defaultRank: "C"
    });
    expect(await releaseUnavailableSaleCustomers(vn("2026-10-08T00:05"))).toBe(1);
    expect(await activeAssignment(pooled)).toBeNull();
    expect(await activeAssignment(referral)).not.toBeNull();

    await UserInfoModel.updateOne(
      { _id: saleA },
      { $set: { resignation_date: vn("2026-10-08T00:00") } }
    );
    expect(await releaseUnavailableSaleCustomers(vn("2026-10-08T00:10"))).toBe(1);
    expect(await activeAssignment(referral)).toBeNull();
  });

  it("khách dưới 18 tuổi vẫn vào kho nhưng phân sau mọi khách khác (chỉ khi Sale còn hạn mức)", async () => {
    expect(isMinorAt(new Date("2010-10-08"), vn("2026-10-07T09:00"))).toBe(true);
    expect(isMinorAt(new Date("2008-10-07"), vn("2026-10-07T09:00"))).toBe(false);
    expect(isMinorAt(null, vn("2026-10-07T09:00"))).toBe(false);

    (listEmployeesByRoleCodes as jest.Mock).mockResolvedValue([
      { employeeId: saleA, accountIsDeleted: false }
    ]);
    await setSaleCaps({ saleId: saleA, capNewPerDay: 1, capTotal: 50, defaultRank: "C" });

    // Khách 16 tuổi vào kho TRƯỚC, khách người lớn vào sau — người lớn vẫn được phân trước
    const minor = await createCustomer({ kyc: true, dateOfBirth: new Date("2010-03-15") });
    await syncCustomerCareByCustomerId(minor, vn("2026-10-07T08:30"));
    const adult = await createCustomer({ kyc: true });
    await syncCustomerCareByCustomerId(adult, vn("2026-10-07T08:40"));
    expect((await careState(minor)).low_priority).toBe(true);
    expect((await careState(adult)).low_priority).toBe(false);

    const run = await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"));
    expect(run).toMatchObject({ assigned: 1, leftInPool: 1 });
    expect(await activeAssignment(adult)).not.toBeNull();
    expect(await activeAssignment(minor)).toBeNull();

    // Ngày làm việc kế tiếp Sale có hạn mức trống → khách dưới 18 tuổi mới được phân
    await allocateCustomerPool("tikluy", vn("2026-10-08T09:00"));
    expect(String((await activeAssignment(minor)).sale_id)).toBe(saleA);
  });

  it("chế độ chạy thử (enabled = false): chỉ ghi nhận Pool, không phân, không thu hồi", async () => {
    await updateCarePolicy("tikluy", { enabled: false }, String(new mongoose.Types.ObjectId()));
    const customerId = await createCustomer();
    await syncCustomerCareByCustomerId(customerId, vn("2026-10-07T08:55"));
    expect((await careState(customerId)).pool_status).toBe("in_pool");
    expect(await allocateCustomerPool("tikluy", vn("2026-10-07T09:00"))).toMatchObject({
      plan: "disabled",
      assigned: 0
    });
  });
});

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMyLeaveLedger, getMyLeaveOverview } from "../src/workflows/get-my-leave.workflow";
import { getMyRequests } from "../src/modules/request/application/get-my-requests.service";
import {
  attachRunningBalance,
  paginateLeaveEntries,
  parseLeaveLedgerType,
  parseLeaveYear,
  summarizeLeaveYear
} from "../src/modules/leave";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const EmploymentStatusModel = require("../src/models/EmploymentStatusModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LeaveBalanceModel = require("../src/models/LeaveBalanceModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RequestModel } = require("../src/models/RequestModel");

let mongod: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  seq = 0;
  await Promise.all([
    UserInfoModel.deleteMany({}),
    EmploymentStatusModel.deleteMany({}),
    LeaveBalanceModel.deleteMany({}),
    RequestModel.deleteMany({})
  ]);
});

const makeStatus = (extra: Record<string, unknown> = {}) => {
  seq += 1;
  return EmploymentStatusModel.create({
    name: "Chính thức",
    code: `ST${seq}`,
    accrues_annual_leave: true,
    can_use_annual_leave: true,
    ...extra
  });
};

const makeUser = (statusId: unknown = null, extra: Record<string, unknown> = {}) => {
  seq += 1;
  return UserInfoModel.create({
    full_name: `NV ${seq}`,
    cccd: `cccd-${seq}`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: new mongoose.Types.ObjectId(),
    ma_nv: `NV${seq}`,
    employment_type: "fulltime",
    employment_status: statusId,
    ...extra
  });
};

const entry = (
  user: any,
  amount: number,
  reason: string,
  at: string,
  extra: Record<string, unknown> = {}
) =>
  LeaveBalanceModel.collection.insertOne({
    user_id: user._id,
    amount,
    reason,
    note: "",
    ref_id: null,
    ref_type: null,
    created_by: null,
    isDeleted: false,
    createdAt: new Date(at),
    updatedAt: new Date(at),
    ...extra
  });

const accountOf = (user: any) => String(user.id_account);

describe("hàm thuần của sổ phép", () => {
  const row = (amount: number, reason: string) => ({
    id: "x",
    createdAt: new Date(),
    reason,
    amount,
    note: "",
    refId: null,
    refType: null
  });

  test("số dư luỹ kế bắt đầu từ số dư đầu năm và không bị sai số số thực", () => {
    const rows = attachRunningBalance(2, [
      row(0.1, "monthly_accrual"),
      row(0.2, "monthly_accrual"),
      row(-0.5, "leave_request_deduction")
    ]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([2.1, 2.3, 1.8]);
  });

  test("đã dùng = trừ do đơn nghỉ trừ phần hoàn; đã cộng = các dòng dương còn lại", () => {
    const entries = attachRunningBalance(0, [
      row(1, "monthly_accrual"),
      row(2, "hr_manual_adjustment"),
      row(-1, "leave_request_deduction"),
      row(1, "reject_refund"),
      row(-2, "leave_request_deduction")
    ]);
    expect(summarizeLeaveYear(entries)).toEqual({ used: 2, added: 3 });
  });

  test("lọc theo chiều biến động và phân trang, mới trước cũ sau", () => {
    const entries = attachRunningBalance(0, [
      row(1, "monthly_accrual"),
      row(-1, "leave_request_deduction"),
      row(1, "monthly_accrual"),
      row(1, "monthly_accrual")
    ]);
    const outOnly = paginateLeaveEntries(entries, "out", {});
    expect(outOnly.data).toHaveLength(1);
    expect(outOnly.pagination.total).toBe(1);

    const page2 = paginateLeaveEntries(entries, "all", { page: 2, limit: 3 });
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].balanceAfter).toBe(1);
    expect(page2.pagination).toEqual({ total: 4, page: 2, limit: 3, total_pages: 2 });
  });

  test("từ chối năm và loại biến động không hợp lệ", () => {
    expect(() => parseLeaveYear("abc")).toThrow("Năm không hợp lệ");
    expect(() => parseLeaveYear(1999)).toThrow("Năm không hợp lệ");
    expect(() => parseLeaveYear(2999)).toThrow("Năm không hợp lệ");
    expect(() => parseLeaveLedgerType("xyz")).toThrow("Loại biến động không hợp lệ");
    expect(parseLeaveLedgerType(undefined)).toBe("all");
  });
});

describe("getMyLeaveLedger", () => {
  test("số dư sau của năm 2026 cộng dồn từ cả năm 2025, mới trước cũ sau", async () => {
    const user = await makeUser();
    await entry(user, 1, "monthly_accrual", "2025-11-01T00:00:00+07:00");
    await entry(user, 1, "monthly_accrual", "2025-12-01T00:00:00+07:00");
    await entry(user, 1, "monthly_accrual", "2026-01-01T00:00:00+07:00");
    await entry(user, -0.5, "leave_request_deduction", "2026-01-10T10:00:00+07:00", {
      ref_type: "request"
    });

    const res = await getMyLeaveLedger(accountOf(user), { year: 2026 });

    expect(res.data.map((e) => e.balance_after)).toEqual([2.5, 3]);
    expect(res.data.map((e) => e.amount)).toEqual([-0.5, 1]);
    expect(res.pagination.total).toBe(2);
  });

  test("mốc giao năm tính theo giờ Việt Nam", async () => {
    const user = await makeUser();
    // 00:00 ngày 01/01/2026 giờ VN = 17:00 ngày 31/12/2025 UTC: thuộc năm 2026, không phải 2025.
    await entry(user, 1, "monthly_accrual", "2026-01-01T00:00:00+07:00");

    const y2026 = await getMyLeaveLedger(accountOf(user), { year: 2026 });
    const y2025 = await getMyLeaveLedger(accountOf(user), { year: 2025 });

    expect(y2026.data).toHaveLength(1);
    expect(y2025.data).toHaveLength(0);
  });

  test("không lẫn dữ liệu của nhân viên khác và bỏ qua dòng đã xoá mềm", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await entry(me, 1, "monthly_accrual", "2026-02-01T00:00:00+07:00");
    await entry(other, 5, "hr_manual_adjustment", "2026-02-02T00:00:00+07:00");
    await entry(me, 9, "hr_manual_adjustment", "2026-02-03T00:00:00+07:00", { isDeleted: true });

    const res = await getMyLeaveLedger(accountOf(me), { year: 2026 });

    expect(res.data).toHaveLength(1);
    expect(res.data[0].amount).toBe(1);
  });

  test("đính kèm đơn nghỉ liên quan cho dòng ghi sổ từ đơn", async () => {
    const user = await makeUser();
    const request = await RequestModel.create({
      request_type: "leave",
      user_id: user._id,
      from_date: new Date("2026-11-24"),
      from_period: "morning",
      to_date: new Date("2026-11-25"),
      to_period: "afternoon",
      total_days: 2,
      leave_type: "paid",
      paid_days: 2
    });
    await entry(user, -2, "leave_request_deduction", "2026-11-12T09:00:00+07:00", {
      ref_type: "request",
      ref_id: request._id
    });
    await entry(user, 1, "monthly_accrual", "2026-11-01T00:00:00+07:00");

    const res = await getMyLeaveLedger(accountOf(user), { year: 2026 });

    expect(res.data[0].request).toMatchObject({ _id: String(request._id), total_days: 2 });
    expect(res.data[1].request).toBeNull();
  });

  test("ném lỗi khi tài khoản chưa có hồ sơ nhân viên", async () => {
    await expect(
      getMyLeaveLedger(String(new mongoose.Types.ObjectId()), { year: 2026 })
    ).rejects.toThrow("Không tìm thấy thông tin nhân viên");
  });
});

describe("getMyLeaveOverview", () => {
  test("trả số dư hiện tại (kể cả khi đang xem năm cũ), đã dùng/đã cộng theo năm và phép đang chờ duyệt", async () => {
    const status = await makeStatus();
    const user = await makeUser(status._id);
    await entry(user, 3, "hr_manual_adjustment", "2025-12-01T00:00:00+07:00");
    await entry(user, 1, "monthly_accrual", "2026-01-01T00:00:00+07:00");
    await entry(user, -2, "leave_request_deduction", "2026-01-05T09:00:00+07:00");
    await RequestModel.create({
      request_type: "leave",
      user_id: user._id,
      status: "pending",
      from_date: new Date("2026-03-02"),
      from_period: "morning",
      to_date: new Date("2026-03-03"),
      to_period: "afternoon",
      total_days: 2,
      leave_type: "paid",
      paid_days: 2
    });

    const now = await getMyLeaveOverview(accountOf(user), { year: 2026 });
    const old = await getMyLeaveOverview(accountOf(user), { year: 2025 });

    expect(now).toMatchObject({
      year: 2026,
      balance: 2,
      used: 2,
      added: 1,
      pending_days: 2,
      monthly_accrual: 1,
      advance_borrow_max_days: 1,
      retroactive_limit_days: 3,
      auto_reject_after_days: 3
    });
    expect(old).toMatchObject({ year: 2025, balance: 2, used: 0, added: 3 });
    expect(now.eligibility).toEqual({
      employment_status_name: "Chính thức",
      accrues_annual_leave: true,
      can_use_annual_leave: true
    });
    expect(now.next_accrual_date).toMatch(/^\d{4}-\d{2}-01$/);
  });

  test("số dư có thể âm và được trả đúng, không ép về 0", async () => {
    const status = await makeStatus();
    const user = await makeUser(status._id);
    await entry(user, 1, "monthly_accrual", "2026-01-01T00:00:00+07:00");
    await entry(user, -3, "hr_manual_adjustment", "2026-01-02T00:00:00+07:00");

    const res = await getMyLeaveOverview(accountOf(user), { year: 2026 });

    expect(res.balance).toBe(-2);
  });

  test("hợp đồng không được cộng phép thì không có ngày cộng kế tiếp", async () => {
    const status = await makeStatus({
      name: "Thử việc",
      accrues_annual_leave: false,
      can_use_annual_leave: false
    });
    const user = await makeUser(status._id);

    const res = await getMyLeaveOverview(accountOf(user), {});

    expect(res.next_accrual_date).toBeNull();
    expect(res.eligibility).toEqual({
      employment_status_name: "Thử việc",
      accrues_annual_leave: false,
      can_use_annual_leave: false
    });
    expect(res.balance).toBe(0);
  });

  test("nhân viên đã nghỉ việc không còn ngày cộng phép kế tiếp", async () => {
    const status = await makeStatus();
    const user = await makeUser(status._id, {
      resignation_date: new Date(Date.now() - 3 * 24 * 3600 * 1000)
    });

    const res = await getMyLeaveOverview(accountOf(user), {});

    expect(res.next_accrual_date).toBeNull();
  });

  test("nhân viên chưa gán loại hợp đồng vẫn trả được, coi như chưa được cộng/dùng phép", async () => {
    const user = await makeUser(null);

    const res = await getMyLeaveOverview(accountOf(user), {});

    expect(res.eligibility).toEqual({
      employment_status_name: null,
      accrues_annual_leave: false,
      can_use_annual_leave: false
    });
  });
});

describe("getMyRequests lọc theo ngày nghỉ", () => {
  const makeLeave = (user: any, from: string, to: string) =>
    RequestModel.create({
      request_type: "leave",
      user_id: user._id,
      from_date: new Date(`${from}T00:00:00+07:00`),
      from_period: "morning",
      to_date: new Date(`${to}T00:00:00+07:00`),
      to_period: "afternoon",
      total_days: 1,
      leave_type: "paid",
      paid_days: 1
    });

  const codes = async (user: any, query: Record<string, unknown>) =>
    (await getMyRequests(user.id_account, { request_type: "leave", ...query })).data.map((r: any) =>
      r.from_date.toISOString().slice(0, 10)
    );

  test("lấy đơn có khoảng nghỉ giao với khoảng đã chọn, kể cả đơn nghỉ nhiều ngày bắc qua mốc", async () => {
    const user = await makeUser();
    await makeLeave(user, "2026-09-05", "2026-09-07");
    await makeLeave(user, "2026-09-30", "2026-10-02");
    await makeLeave(user, "2026-11-04", "2026-11-04");

    expect(await codes(user, { event_from: "2026-10-01", event_to: "2026-10-31" })).toEqual([
      "2026-09-29"
    ]);
    expect(await codes(user, { event_from: "2026-11-01" })).toEqual(["2026-11-03"]);
    expect(await codes(user, { event_to: "2026-09-06" })).toEqual(["2026-09-04"]);
    expect(await codes(user, { event_from: "2026-12-01" })).toEqual([]);
  });

  test("không trả đơn của người khác và từ chối ngày sai định dạng", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await makeLeave(other, "2026-10-10", "2026-10-10");

    expect(await codes(me, { event_from: "2026-10-01", event_to: "2026-10-31" })).toEqual([]);
    await expect(getMyRequests(me.id_account, { event_from: "10/10/2026" })).rejects.toThrow(
      "event_from"
    );
  });
});

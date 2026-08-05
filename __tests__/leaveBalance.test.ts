import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  getLeaveBalance,
  adjustLeaveBalance,
  InsufficientLeaveBalanceError
} from "../src/modules/leave";
import { ArgumentInvalidException } from "../src/core/exceptions/exceptions";
import LeaveBalanceModel from "../src/models/LeaveBalanceModel";
import { LEAVE_BALANCE_REASON } from "../src/constants";
import redisMock from "./mocks/redis";

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
  await LeaveBalanceModel.deleteMany({});
  redisMock.__store.clear();
});

const newUserId = () => new mongoose.Types.ObjectId().toString();

describe("getLeaveBalance", () => {
  test("SUM đúng với nhiều dòng (+/-/refund)", async () => {
    const userId = newUserId();
    await LeaveBalanceModel.create([
      { user_id: userId, amount: 1, reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL },
      { user_id: userId, amount: -1, reason: LEAVE_BALANCE_REASON.LEAVE_REQUEST_DEDUCTION },
      { user_id: userId, amount: 0.5, reason: LEAVE_BALANCE_REASON.REJECT_REFUND }
    ]);
    expect(await getLeaveBalance(userId)).toBe(0.5);
  });

  test("SUM bỏ qua dòng isDeleted:true", async () => {
    const userId = newUserId();
    await LeaveBalanceModel.create([
      { user_id: userId, amount: 2, reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL },
      { user_id: userId, amount: 5, reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL, isDeleted: true }
    ]);
    expect(await getLeaveBalance(userId)).toBe(2);
  });

  test("SUM cô lập theo user, không lẫn user khác", async () => {
    const userA = newUserId();
    const userB = newUserId();
    await LeaveBalanceModel.create([
      { user_id: userA, amount: 3, reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL },
      { user_id: userB, amount: 99, reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL }
    ]);
    expect(await getLeaveBalance(userA)).toBe(3);
  });
});

describe("adjustLeaveBalance", () => {
  test("chặn âm mặc định — throw và không tạo dòng ledger nào", async () => {
    const userId = newUserId();
    await LeaveBalanceModel.create({
      user_id: userId,
      amount: 2,
      reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL
    });

    await expect(
      adjustLeaveBalance({
        userId,
        amount: -5,
        reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
      })
    ).rejects.toBeInstanceOf(InsufficientLeaveBalanceError);

    expect(await LeaveBalanceModel.countDocuments({ user_id: userId })).toBe(1);
    expect(await getLeaveBalance(userId)).toBe(2);
  });

  test("allowNegative:true — thành công, balance âm đúng như kỳ vọng", async () => {
    const userId = newUserId();
    await LeaveBalanceModel.create({
      user_id: userId,
      amount: 2,
      reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL
    });

    const result = await adjustLeaveBalance({
      userId,
      amount: -5,
      reason: LEAVE_BALANCE_REASON.LEAVE_REQUEST_DEDUCTION,
      allowNegative: true
    });

    expect(result.balance).toBe(-3);
    expect(await getLeaveBalance(userId)).toBe(-3);
  });

  test("guard amount === 0 → throw", async () => {
    const userId = newUserId();
    await expect(
      adjustLeaveBalance({ userId, amount: 0, reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT })
    ).rejects.toBeInstanceOf(ArgumentInvalidException);
  });

  test("guard reason không hợp lệ → throw", async () => {
    const userId = newUserId();
    await expect(
      adjustLeaveBalance({ userId, amount: 1, reason: "khong_ton_tai" })
    ).rejects.toBeInstanceOf(ArgumentInvalidException);
  });

  test("balance_after chỉ là snapshot — sửa tay không ảnh hưởng getLeaveBalance", async () => {
    const userId = newUserId();
    await adjustLeaveBalance({
      userId,
      amount: 3,
      reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL
    });
    const ledgerEntry: any = await LeaveBalanceModel.findOne({ user_id: userId });
    expect(ledgerEntry.balance_after).toBe(3);

    await LeaveBalanceModel.updateOne({ _id: ledgerEntry._id }, { balance_after: 999 });
    expect(await getLeaveBalance(userId)).toBe(3);
  });

  test("race 2 lệnh đồng thời cùng user — balance cuối không bao giờ sai", async () => {
    const userId = newUserId();
    await LeaveBalanceModel.create({
      user_id: userId,
      amount: 1,
      reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL
    });

    const results = await Promise.allSettled([
      adjustLeaveBalance({
        userId,
        amount: -1,
        reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
      }),
      adjustLeaveBalance({
        userId,
        amount: -1,
        reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
      })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(await getLeaveBalance(userId)).toBe(0);
  });
});

const mongoose = require("mongoose");
const LeaveBalanceModel = require("../models/LeaveBalanceModel");
const redis = require("../config/redis");
const { LEAVE_BALANCE_REASON_VALUES } = require("../constants");

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_BUDGET_MS = 10000;

const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");

class LeaveBalanceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getLeaveBalance(userId, session) {
  const [row] = await LeaveBalanceModel.aggregate([
    { $match: { user_id: new mongoose.Types.ObjectId(String(userId)), isDeleted: false } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]).session(session ?? null);
  return row ? row.total : 0;
}

async function acquireUserLeaveLock(userId) {
  const key = `${ENV_PREFIX}:leave_balance:lock:${String(userId)}`;
  const token = `${Date.now()}-${Math.random()}`;
  const deadline = Date.now() + LOCK_WAIT_BUDGET_MS;

  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (ok === "OK") {
      return async () => {
        try {
          const val = await redis.get(key);
          if (val === token) await redis.del(key);
        } catch {
          // best-effort release — TTL là lưới an toàn thực sự
        }
      };
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50 + Math.random() * 50);
    });
  }
  throw new LeaveBalanceError(
    409,
    "Hệ thống đang xử lý điều chỉnh phép khác cho nhân viên này, vui lòng thử lại"
  );
}

async function adjustLeaveBalance({
  userId,
  amount,
  reason,
  refId = null,
  refType = null,
  note = "",
  createdBy = null,
  allowNegative = false,
  session = null
}) {
  if (!amount || Number.isNaN(Number(amount))) {
    throw new LeaveBalanceError(400, "Số ngày điều chỉnh không hợp lệ");
  }
  if (!LEAVE_BALANCE_REASON_VALUES.includes(reason)) {
    throw new LeaveBalanceError(400, "Lý do điều chỉnh không hợp lệ");
  }

  const release = await acquireUserLeaveLock(userId);
  try {
    const currentBalance = await getLeaveBalance(userId, session);
    const newBalance = currentBalance + amount;

    if (newBalance < 0 && !allowNegative) {
      throw new LeaveBalanceError(400, "Số dư phép không đủ để thực hiện điều chỉnh này");
    }

    const [row] = await LeaveBalanceModel.create(
      [
        {
          user_id: userId,
          amount,
          reason,
          ref_id: refId,
          ref_type: refType,
          note,
          created_by: createdBy,
          balance_after: newBalance
        }
      ],
      { session }
    );

    return { balance: newBalance, ledgerEntry: row };
  } finally {
    await release();
  }
}

module.exports = {
  LeaveBalanceError,
  getLeaveBalance,
  adjustLeaveBalance
};

import { ClientSession } from "mongoose";
import { LEAVE_BALANCE_REASON_VALUES } from "../../../constants";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { EmployeeId } from "../../../shared-kernel/employee-id";
import { Money } from "../../../shared-kernel/money";
import { LeaveBalanceRepository } from "../infrastructure/leave-balance.repository";
import { acquireUserLeaveLock } from "../infrastructure/leave-balance-lock";

const repository = new LeaveBalanceRepository();

export interface AdjustLeaveBalanceInput {
  userId: string;
  amount: number;
  reason: string;
  refId?: string | null;
  refType?: "request" | "system" | "manual" | null;
  note?: string;
  createdBy?: string | null;
  allowNegative?: boolean;
  session?: ClientSession;
}

export interface AdjustLeaveBalanceResult {
  balance: number;
}

export async function adjustLeaveBalance({
  userId,
  amount,
  reason,
  refId = null,
  refType = null,
  note = "",
  createdBy = null,
  allowNegative = false,
  session
}: AdjustLeaveBalanceInput): Promise<AdjustLeaveBalanceResult> {
  if (!amount || Number.isNaN(Number(amount))) {
    throw new ArgumentInvalidException("Số ngày điều chỉnh không hợp lệ");
  }
  if (!(LEAVE_BALANCE_REASON_VALUES as string[]).includes(reason)) {
    throw new ArgumentInvalidException("Lý do điều chỉnh không hợp lệ");
  }

  const employeeId = EmployeeId.of(userId);
  const release = await acquireUserLeaveLock(employeeId.toString());
  try {
    const balance = await repository.getBalance(employeeId, session);
    const newBalance = balance.applyAdjustment(Money.of(amount), allowNegative);

    await repository.appendLedgerEntry(
      {
        employeeId,
        amount,
        reason,
        refId,
        refType,
        note,
        createdBy,
        balanceAfter: newBalance
      },
      session
    );

    return { balance: newBalance.toNumber() };
  } finally {
    await release();
  }
}

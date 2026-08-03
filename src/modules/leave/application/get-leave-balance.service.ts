import { ClientSession } from "mongoose";
import { EmployeeId } from "../../../shared-kernel/employee-id";
import { LeaveBalanceRepository } from "../infrastructure/leave-balance.repository";

const repository = new LeaveBalanceRepository();

export async function getLeaveBalance(userId: string, session?: ClientSession): Promise<number> {
  const balance = await repository.getBalance(EmployeeId.of(userId), session);
  return balance.amount.toNumber();
}

import { ClientSession } from "mongoose";
import { EmployeeId } from "../../../shared-kernel/employee-id";
import { LeaveBalanceRepository } from "../infrastructure/leave-balance.repository";

const repository = new LeaveBalanceRepository();

// Port nguyên `getLeaveBalance` (đọc thuần, không lock — không có invariant nào cần bảo vệ khi chỉ
// đọc) từ `helpers/leaveBalance.js`. Dùng ở các nơi hiển thị số dư phép, không điều chỉnh.
export async function getLeaveBalance(userId: string, session?: ClientSession): Promise<number> {
  const balance = await repository.getBalance(EmployeeId.of(userId), session);
  return balance.amount.toNumber();
}

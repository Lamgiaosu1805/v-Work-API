import mongoose, { ClientSession } from "mongoose";
import LeaveBalanceModel from "../../../models/LeaveBalanceModel";
import { RequestContextService } from "../../../core/context/request-context";
import { EmployeeId } from "../../../shared-kernel/employee-id";
import { Money } from "../../../shared-kernel/money";
import { LeaveBalance } from "../domain/leave-balance.entity";

export interface LeaveLedgerEntryInput {
  employeeId: EmployeeId;
  amount: number;
  reason: string;
  refId?: string | null;
  refType?: "request" | "system" | "manual" | null;
  note?: string;
  createdBy?: string | null;
  balanceAfter: Money;
}

export class LeaveBalanceRepository {
  // eslint-disable-next-line class-methods-use-this
  private resolveSession(session?: ClientSession): ClientSession | undefined {
    return session ?? (RequestContextService.getTransactionSession() as ClientSession | undefined);
  }

  async getBalance(employeeId: EmployeeId, session?: ClientSession): Promise<LeaveBalance> {
    const [row] = await LeaveBalanceModel.aggregate([
      {
        $match: {
          user_id: new mongoose.Types.ObjectId(employeeId.toString()),
          isDeleted: false
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]).session(this.resolveSession(session) ?? null);

    return LeaveBalance.reconstitute(employeeId, Money.of(row ? row.total : 0));
  }

  async appendLedgerEntry(entry: LeaveLedgerEntryInput, session?: ClientSession): Promise<void> {
    await LeaveBalanceModel.create(
      [
        {
          user_id: entry.employeeId.toString(),
          amount: entry.amount,
          reason: entry.reason,
          ref_id: entry.refId ?? null,
          ref_type: entry.refType ?? null,
          note: entry.note ?? "",
          created_by: entry.createdBy ?? null,
          balance_after: entry.balanceAfter.toNumber()
        }
      ],
      { session: this.resolveSession(session) ?? null }
    );
  }
}

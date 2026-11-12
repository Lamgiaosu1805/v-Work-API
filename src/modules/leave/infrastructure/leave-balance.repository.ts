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

export interface LeaveLedgerRow {
  id: string;
  createdAt: Date;
  reason: string;
  amount: number;
  note: string;
  refId: string | null;
  refType: string | null;
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

  // Tổng các dòng sổ phát sinh TRƯỚC mốc `before` — số dư đầu kỳ để tính số dư luỹ kế cho từng dòng trong năm.
  // eslint-disable-next-line class-methods-use-this
  async sumBefore(employeeId: EmployeeId, before: Date): Promise<number> {
    const [row] = await LeaveBalanceModel.aggregate([
      {
        $match: {
          user_id: new mongoose.Types.ObjectId(employeeId.toString()),
          isDeleted: false,
          createdAt: { $lt: before }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    return row ? row.total : 0;
  }

  // Các dòng sổ trong [from, to), cũ → mới (đồng hạng thì theo _id) để cộng dồn đúng thứ tự ghi sổ.
  // eslint-disable-next-line class-methods-use-this
  async findInRange(employeeId: EmployeeId, from: Date, to: Date): Promise<LeaveLedgerRow[]> {
    const rows = await LeaveBalanceModel.find({
      user_id: employeeId.toString(),
      isDeleted: false,
      createdAt: { $gte: from, $lt: to }
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    return rows.map((r: any) => ({
      id: String(r._id),
      createdAt: r.createdAt as Date,
      reason: r.reason as string,
      amount: r.amount as number,
      note: (r.note as string) ?? "",
      refId: r.ref_id ? String(r.ref_id) : null,
      refType: (r.ref_type as string | null) ?? null
    }));
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

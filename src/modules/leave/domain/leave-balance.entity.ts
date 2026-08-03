import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { EmployeeId } from "../../../shared-kernel/employee-id";
import { Money } from "../../../shared-kernel/money";
import { InsufficientLeaveBalanceError } from "./leave-balance.errors";

export interface LeaveBalanceProps {
  amount: number;
}

export class LeaveBalance extends Entity<LeaveBalanceProps> {
  static reconstitute(employeeId: EmployeeId, currentAmount: Money): LeaveBalance {
    return new LeaveBalance(
      { id: employeeId.toString(), props: { amount: currentAmount.toNumber() } },
      { validate: false }
    );
  }

  get amount(): Money {
    return Money.of(this.props.amount);
  }

  applyAdjustment(delta: Money, allowNegative: boolean): Money {
    const newBalance = this.amount.add(delta);
    if (newBalance.isNegative() && !allowNegative) {
      throw new InsufficientLeaveBalanceError();
    }
    this._setProps({ amount: newBalance.toNumber() });
    return newBalance;
  }

  validate(): void {
    if (typeof this.props.amount !== "number" || Number.isNaN(this.props.amount)) {
      throw new ArgumentInvalidException("LeaveBalance.amount không hợp lệ");
    }
  }
}

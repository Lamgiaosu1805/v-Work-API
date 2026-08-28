import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export interface CustomerCallStatsProps {
  customerId: string;
  callCount: number;
  lastContactedAt: Date | null;
}

export interface CreateCustomerCallStatsInput {
  id: string;
  customerId: string;
}

export class CustomerCallStatsEntity extends Entity<CustomerCallStatsProps> {
  static create({ id, customerId }: CreateCustomerCallStatsInput): CustomerCallStatsEntity {
    return new CustomerCallStatsEntity({
      id,
      props: { customerId, callCount: 0, lastContactedAt: null }
    });
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get callCount(): number {
    return this.props.callCount;
  }

  get lastContactedAt(): Date | null {
    return this.props.lastContactedAt;
  }

  recordCallAttempt(now: Date = new Date()): void {
    this._setProps({ callCount: this.props.callCount + 1, lastContactedAt: now });
  }

  validate(): void {
    if (!this.props.customerId || typeof this.props.customerId !== "string") {
      throw new ArgumentInvalidException("CustomerCallStats thiếu customerId hợp lệ");
    }
    if (typeof this.props.callCount !== "number" || this.props.callCount < 0) {
      throw new ArgumentInvalidException("CustomerCallStats.callCount không hợp lệ");
    }
  }
}

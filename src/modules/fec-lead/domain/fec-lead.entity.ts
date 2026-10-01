import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { FecLeadCompletedDomainEvent } from "./events/fec-lead-completed.domain-event";
import { FecLeadProps } from "./types";

export interface CreateFecLeadInput {
  id: string;
  props: FecLeadProps;
}

export interface ApplyFecLeadUpdateResult {
  applied: boolean;
}

export class FecLeadEntity extends AggregateRoot<FecLeadProps> {
  static create({ id, props }: CreateFecLeadInput): FecLeadEntity {
    const entity = new FecLeadEntity({ id, props });
    if (props.stage === "COMPLETED") {
      entity._emitCompleted();
    }
    return entity;
  }

  get leadGenId(): string {
    return this.props.lead_gen_id;
  }

  get version(): number {
    return this.props.version;
  }

  get stage() {
    return this.props.stage;
  }

  applyUpdate(newProps: FecLeadProps): ApplyFecLeadUpdateResult {
    if (newProps.version < this.props.version) {
      return { applied: false };
    }

    const wasCompleted = this.props.stage === "COMPLETED";
    this._setProps(newProps);

    if (!wasCompleted && newProps.stage === "COMPLETED") {
      this._emitCompleted();
    }

    return { applied: true };
  }

  private _emitCompleted(): void {
    this.addEvent(
      new FecLeadCompletedDomainEvent({
        aggregateId: this.id,
        leadGenId: this.props.lead_gen_id,
        customerId: this.props.customer_id
      })
    );
  }

  validate(): void {
    if (!this.props.lead_gen_id) {
      throw new ArgumentInvalidException("FecLead thiếu lead_gen_id");
    }
    if (!this.props.customer_id) {
      throw new ArgumentInvalidException("FecLead thiếu customer_id");
    }
    if (!Number.isFinite(this.props.version) || this.props.version < 0) {
      throw new ArgumentInvalidException("FecLead version không hợp lệ");
    }
  }
}

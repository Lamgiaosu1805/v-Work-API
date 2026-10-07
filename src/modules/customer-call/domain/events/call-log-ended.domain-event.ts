import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface CallLogEndedDomainEventProps extends DomainEventProps {
  saleId: string | null;
  customerId: string | null;
  direction: string;
  timeStartCall: Date;
  answerSec: number;
}

/** Cuộc gọi tổng đài đã kết thúc (webhook OMICall lần đầu có thời điểm kết thúc). */
export class CallLogEndedDomainEvent extends DomainEvent {
  readonly saleId: string | null;

  readonly customerId: string | null;

  readonly direction: string;

  readonly timeStartCall: Date;

  readonly answerSec: number;

  constructor(props: CallLogEndedDomainEventProps) {
    super(props);
    this.saleId = props.saleId;
    this.customerId = props.customerId;
    this.direction = props.direction;
    this.timeStartCall = props.timeStartCall;
    this.answerSec = props.answerSec;
  }
}

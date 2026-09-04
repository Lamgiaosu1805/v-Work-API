import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export type CallLogDirection = "outbound" | "inbound" | "local";

const VALID_DIRECTIONS: CallLogDirection[] = ["outbound", "inbound", "local"];

export interface CallLogPayload {
  transactionId: string;
  callUuid: string;
  direction: CallLogDirection;
  phoneNumber: string;
  hotline: string;
  fromNumber: string;
  toNumber: string;
  sipUser: string;
  saleId: string | null;
  customerId: string | null;
  answerSec: number;
  billSec: number;
  duration: number;
  callOutPrice: number;
  timeStartCall: Date;
  timeRingingStart: Date | null;
  timeAnswerStart: Date | null;
  timeEndCall: Date | null;
  hangupCause: string;
  recordingFileUrl: string;
  recordSeconds: number;
  note: string;
  tag: string[];
  rawPayload: unknown;
}

export interface CreateCallLogInput extends CallLogPayload {
  id: string;
}

export class CallLogEntity extends Entity<CallLogPayload> {
  static create({ id, ...payload }: CreateCallLogInput): CallLogEntity {
    return new CallLogEntity({ id, props: payload });
  }

  get transactionId(): string {
    return this.props.transactionId;
  }

  get note(): string {
    return this.props.note;
  }

  get saleId(): string | null {
    return this.props.saleId;
  }

  applyWebhookPayload(payload: CallLogPayload): void {
    this._setProps(payload);
  }

  updateNote(note: string): void {
    this._setProps({ ...this.props, note });
  }

  validate(): void {
    if (!this.props.transactionId || typeof this.props.transactionId !== "string") {
      throw new ArgumentInvalidException("CallLog thiếu transactionId hợp lệ");
    }
    if (!VALID_DIRECTIONS.includes(this.props.direction)) {
      throw new ArgumentInvalidException("CallLog.direction không hợp lệ");
    }
    if (!this.props.phoneNumber || typeof this.props.phoneNumber !== "string") {
      throw new ArgumentInvalidException("CallLog thiếu phoneNumber hợp lệ");
    }
    if (!(this.props.timeStartCall instanceof Date)) {
      throw new ArgumentInvalidException("CallLog thiếu timeStartCall hợp lệ");
    }
  }
}

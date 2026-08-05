import mongoose from "mongoose";
import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import {
  CannotSelfReviewError,
  AlreadyReviewedError,
  InvalidStatusTransitionError
} from "./request.errors";
import { RequestCreatedDomainEvent } from "./events/request-created.domain-event";
import { RequestPartiallyApprovedDomainEvent } from "./events/request-partially-approved.domain-event";
import { RequestApprovedDomainEvent } from "./events/request-approved.domain-event";
import { RequestRejectedDomainEvent } from "./events/request-rejected.domain-event";
import { RequestCancelledDomainEvent } from "./events/request-cancelled.domain-event";
import { RequestType, RequestProps, RequestStatus } from "./types";

const VALID_STATUSES: RequestStatus[] = ["pending", "approved", "rejected", "cancelled"];

// SRS "Nghỉ dài hạn": ngưỡng 2 cấp duyệt là "> 2 ngày" (không phải > 3 — đã sửa theo yêu cầu người
// dùng sau khi đối chiếu lại tài liệu SRS v2.0, 03/08/2026).
const MULTI_APPROVAL_RULES: Partial<Record<RequestType, (props: RequestProps) => boolean>> = {
  leave: (props) => (props.total_days ?? 0) > 2,
  forgot_checkin: (props) => (props.occurrence ?? 0) >= 6,
  late_early: (props) => (props.occurrence ?? 0) >= 4
};

export const REQUEST_TYPE_FIELDS: Record<RequestType, string[]> = {
  leave: [
    "from_date",
    "from_period",
    "to_date",
    "to_period",
    "total_days",
    "leave_type",
    "paid_days",
    "unpaid_days"
  ],
  late_early: ["date", "shift_id", "type", "minutes", "occurrence"],
  remote: ["from_date", "to_date", "total_days"],
  business_trip: ["from_date", "to_date", "total_days", "destination_location"],
  client_visit: ["from_date", "to_date", "total_days", "start_time", "end_time"],
  explanation: ["date", "shift_id", "content"],
  forgot_checkin: ["date", "type", "expected_check_in", "expected_check_out", "occurrence"]
};

const COMMON_FIELDS = [
  "user_id",
  "request_type",
  "reason",
  "status",
  "reviewed_by",
  "reviewed_at",
  "reviewer_note",
  "approvals"
];

export interface CreateRequestInput {
  userId: string;
  requestType: RequestType;
  reason?: string;
  [key: string]: unknown;
}

export class RequestEntity extends AggregateRoot<RequestProps> {
  static create({ userId, requestType, reason, ...typeSpecificProps }: CreateRequestInput) {
    const id = new mongoose.Types.ObjectId().toString();
    const props = {
      user_id: userId,
      request_type: requestType,
      reason: reason || "",
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      reviewer_note: "",
      approvals: [],
      ...typeSpecificProps
    } as RequestProps;

    const request = new RequestEntity({ id, props });
    request.addEvent(new RequestCreatedDomainEvent({ aggregateId: id, userId, requestType }));
    return request;
  }

  get status(): RequestStatus {
    return this.props.status;
  }

  get userId(): string {
    return this.props.user_id;
  }

  get requestType(): RequestType {
    return this.props.request_type;
  }

  get approvals() {
    return [...this.props.approvals];
  }

  needsMultiApproval(): boolean {
    const rule = MULTI_APPROVAL_RULES[this.props.request_type];
    return rule ? rule(this.props) : false;
  }

  approve(reviewerId: string, reviewerNote = ""): void {
    this._assertNotSelfReview(reviewerId);
    this._assertPending();

    if (!this.needsMultiApproval()) {
      this._finalizeApproval(reviewerId, reviewerNote);
      return;
    }

    const alreadyApproved = this.props.approvals.some(
      (approval) => String(approval.account) === String(reviewerId)
    );
    if (alreadyApproved) {
      throw new AlreadyReviewedError(undefined, {
        metadata: { requestId: this.id, reviewerId }
      });
    }

    const approvals = [...this.props.approvals, { account: reviewerId, reviewed_at: new Date() }];

    if (approvals.length >= 2) {
      this._setProps({ approvals });
      this._finalizeApproval(reviewerId, reviewerNote);
    } else {
      this._setProps({ approvals });
      this.addEvent(
        new RequestPartiallyApprovedDomainEvent({
          aggregateId: this.id,
          userId: this.props.user_id,
          reviewerId,
          requestType: this.props.request_type
        })
      );
    }
  }

  reject(reviewerId: string, reviewerNote = ""): void {
    this._assertNotSelfReview(reviewerId);
    this._assertPending();
    const overriddenApprovals = [...this.props.approvals];
    this._setProps({
      status: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      reviewer_note: reviewerNote
    });
    this.addEvent(
      new RequestRejectedDomainEvent({
        aggregateId: this.id,
        userId: this.props.user_id,
        reviewerId,
        requestType: this.props.request_type,
        reviewerNote,
        overriddenApprovals
      })
    );
  }

  cancel(): void {
    this._assertPending();
    // Đơn đa cấp (leave >3 ngày / forgot_checkin >=6 lần / late_early >=4 lần): sau khi cấp 1 đã duyệt,
    // status vẫn "pending" cho tới khi đủ cấp cuối (xem approve() bên dưới) — nếu chỉ check status thì
    // nhân viên tự huỷ được đơn đã có người duyệt mà không ai hay biết. Chặn thêm ở đây.
    if (this.props.approvals.length > 0) {
      throw new InvalidStatusTransitionError(
        "Đơn đã có người duyệt, không thể tự huỷ — vui lòng liên hệ người duyệt để từ chối đơn",
        { metadata: { requestId: this.id, approvalsCount: this.props.approvals.length } }
      );
    }
    this._setProps({ status: "cancelled" });
    this.addEvent(
      new RequestCancelledDomainEvent({
        aggregateId: this.id,
        userId: this.props.user_id,
        requestType: this.props.request_type
      })
    );
  }

  private _finalizeApproval(reviewerId: string, reviewerNote: string): void {
    this._setProps({
      status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      reviewer_note: reviewerNote
    });
    this.addEvent(
      new RequestApprovedDomainEvent({
        aggregateId: this.id,
        userId: this.props.user_id,
        reviewerId,
        requestType: this.props.request_type
      })
    );
  }

  private _assertNotSelfReview(reviewerId: string): void {
    if (String(this.props.user_id) === String(reviewerId)) {
      throw new CannotSelfReviewError(undefined, {
        metadata: { requestId: this.id, userId: this.props.user_id, reviewerId }
      });
    }
  }

  private _assertPending(): void {
    if (this.props.status !== "pending") {
      throw new InvalidStatusTransitionError(
        `Đơn đang ở trạng thái "${this.props.status}", không thể thực hiện hành động này`,
        { metadata: { requestId: this.id, currentStatus: this.props.status } }
      );
    }
  }

  validate(): void {
    if (!VALID_STATUSES.includes(this.props.status)) {
      throw new ArgumentInvalidException(`Trạng thái đơn không hợp lệ: ${this.props.status}`);
    }

    const allowedFields = new Set([
      ...COMMON_FIELDS,
      ...(REQUEST_TYPE_FIELDS[this.props.request_type] || [])
    ]);
    const strayFields = Object.keys(this.props).filter((field) => !allowedFields.has(field));
    if (strayFields.length > 0) {
      throw new ArgumentInvalidException(
        `Đơn loại "${this.props.request_type}" có field không thuộc về nó: ${strayFields.join(", ")}`
      );
    }
  }
}

const mongoose = require("mongoose");
const { AggregateRoot } = require("../../../core/ddd/aggregate-root.base");
const { ArgumentInvalidException } = require("../../../core/exceptions/exceptions");
const {
  CannotSelfReviewError,
  AlreadyReviewedError,
  InvalidStatusTransitionError
} = require("./request.errors");
const { RequestCreatedDomainEvent } = require("./events/request-created.domain-event");
const {
  RequestPartiallyApprovedDomainEvent
} = require("./events/request-partially-approved.domain-event");
const { RequestApprovedDomainEvent } = require("./events/request-approved.domain-event");
const { RequestRejectedDomainEvent } = require("./events/request-rejected.domain-event");
const { RequestCancelledDomainEvent } = require("./events/request-cancelled.domain-event");

const VALID_STATUSES = ["pending", "approved", "rejected", "cancelled"];

const MULTI_APPROVAL_RULES = {
  leave: (props) => props.total_days > 3,
  forgot_checkin: (props) => (props.occurrence ?? 0) >= 6,
  late_early: (props) => (props.occurrence ?? 0) >= 4
};

const REQUEST_TYPE_FIELDS = {
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
  business_trip: ["from_date", "to_date", "total_days"],
  client_visit: ["from_date", "to_date", "total_days"],
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

class RequestEntity extends AggregateRoot {
  static create({ userId, requestType, reason, ...typeSpecificProps }) {
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
    };

    const request = new RequestEntity({ id, props });
    request.addEvent(new RequestCreatedDomainEvent({ aggregateId: id, userId, requestType }));
    return request;
  }

  get status() {
    return this.props.status;
  }

  get userId() {
    return this.props.user_id;
  }

  get requestType() {
    return this.props.request_type;
  }

  get approvals() {
    return [...this.props.approvals];
  }

  needsMultiApproval() {
    const rule = MULTI_APPROVAL_RULES[this.props.request_type];
    return rule ? rule(this.props) : false;
  }

  approve(reviewerId, reviewerNote = "") {
    this._assertNotSelfReview(reviewerId);
    this._assertPending();

    if (!this.needsMultiApproval()) {
      this._finalizeApproval(reviewerId, reviewerNote);
      return;
    }

    const alreadyApproved = this.props.approvals.some(
      (approval) => String(approval.account) === String(reviewerId)
    );
    if (alreadyApproved) throw new AlreadyReviewedError();

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

  reject(reviewerId, reviewerNote = "") {
    this._assertNotSelfReview(reviewerId);
    this._assertPending();
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
        reviewerNote
      })
    );
  }

  cancel() {
    this._assertPending();
    this._setProps({ status: "cancelled" });
    this.addEvent(
      new RequestCancelledDomainEvent({
        aggregateId: this.id,
        userId: this.props.user_id,
        requestType: this.props.request_type
      })
    );
  }

  _finalizeApproval(reviewerId, reviewerNote) {
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

  _assertNotSelfReview(reviewerId) {
    if (String(this.props.user_id) === String(reviewerId)) {
      throw new CannotSelfReviewError();
    }
  }

  _assertPending() {
    if (this.props.status !== "pending") {
      throw new InvalidStatusTransitionError(
        `Đơn đang ở trạng thái "${this.props.status}", không thể thực hiện hành động này`
      );
    }
  }

  validate() {
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

module.exports = { RequestEntity, REQUEST_TYPE_FIELDS };

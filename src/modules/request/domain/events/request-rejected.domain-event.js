const { DomainEvent } = require("../../../../core/ddd/domain-event.base");

class RequestRejectedDomainEvent extends DomainEvent {
  constructor(props) {
    super(props);
    this.userId = props.userId;
    this.reviewerId = props.reviewerId;
    this.requestType = props.requestType;
    this.reviewerNote = props.reviewerNote;
  }
}

module.exports = { RequestRejectedDomainEvent };

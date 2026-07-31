const { DomainEvent } = require("../../../../core/ddd/domain-event.base");

class RequestApprovedDomainEvent extends DomainEvent {
  constructor(props) {
    super(props);
    this.userId = props.userId;
    this.reviewerId = props.reviewerId;
    this.requestType = props.requestType;
  }
}

module.exports = { RequestApprovedDomainEvent };

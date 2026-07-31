const { DomainEvent } = require("../../../../core/ddd/domain-event.base");

class RequestCancelledDomainEvent extends DomainEvent {
  constructor(props) {
    super(props);
    this.userId = props.userId;
    this.requestType = props.requestType;
  }
}

module.exports = { RequestCancelledDomainEvent };

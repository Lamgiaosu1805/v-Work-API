const { DomainEvent } = require("../../../../core/ddd/domain-event.base");

class RequestCreatedDomainEvent extends DomainEvent {
  constructor(props) {
    super(props);
    this.userId = props.userId;
    this.requestType = props.requestType;
  }
}

module.exports = { RequestCreatedDomainEvent };

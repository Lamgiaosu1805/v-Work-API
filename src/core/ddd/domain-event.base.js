const { randomUUID } = require("crypto");
const { ArgumentNotProvidedException } = require("../exceptions/exceptions");
const { RequestContextService } = require("../context/request-context");

class DomainEvent {
  constructor(props) {
    if (!props || typeof props !== "object" || !props.aggregateId) {
      throw new ArgumentNotProvidedException("DomainEvent requires props.aggregateId.");
    }

    this.id = randomUUID();
    this.aggregateId = props.aggregateId;
    this.metadata = {
      correlationId: props.metadata?.correlationId || RequestContextService.getRequestId(),
      causationId: props.metadata?.causationId,
      timestamp: props.metadata?.timestamp || Date.now(),
      userId: props.metadata?.userId
    };
  }
}

module.exports = { DomainEvent };

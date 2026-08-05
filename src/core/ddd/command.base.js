const { randomUUID } = require("crypto");
const { ArgumentNotProvidedException } = require("../exceptions/exceptions");
const { RequestContextService } = require("../context/request-context");

class Command {
  constructor(props) {
    if (!props || typeof props !== "object") {
      throw new ArgumentNotProvidedException("Command props should not be empty.");
    }

    this.id = props.id || randomUUID();
    this.metadata = {
      correlationId: props.metadata?.correlationId || RequestContextService.getRequestId(),
      causationId: props.metadata?.causationId,
      timestamp: props.metadata?.timestamp || Date.now(),
      userId: props.metadata?.userId
    };
  }
}

module.exports = { Command };

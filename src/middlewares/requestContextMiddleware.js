const { randomUUID } = require("crypto");
const { RequestContextService } = require("../core/context/request-context");

function requestContextMiddleware(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  RequestContextService.run({ requestId }, () => next());
}

module.exports = requestContextMiddleware;

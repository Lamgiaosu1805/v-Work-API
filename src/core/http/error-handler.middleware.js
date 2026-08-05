const { sendExceptionResponse } = require("./handle-exception");

// eslint-disable-next-line no-unused-vars
function errorHandlerMiddleware(err, req, res, next) {
  sendExceptionResponse(res, err);
}

module.exports = { errorHandlerMiddleware };

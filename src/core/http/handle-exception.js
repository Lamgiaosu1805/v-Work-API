const { ExceptionBase } = require("../exceptions/exception.base");

function sendExceptionResponse(res, error) {
  if (error instanceof ExceptionBase) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return res.status(500).json({ message: "Lỗi server", error: error.message });
}

module.exports = { sendExceptionResponse };

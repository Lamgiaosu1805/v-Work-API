/* eslint-disable max-classes-per-file */
const { ExceptionBase } = require("../../../core/exceptions/exception.base");

class CannotSelfReviewError extends ExceptionBase {
  static defaultMessage = "Không thể tự duyệt đơn của mình";

  code = "REQUEST.CANNOT_SELF_REVIEW";

  statusCode = 403;

  constructor(message = CannotSelfReviewError.defaultMessage, options = {}) {
    super(message, options);
  }
}

class AlreadyReviewedError extends ExceptionBase {
  static defaultMessage = "Bạn đã duyệt đơn này rồi";

  code = "REQUEST.ALREADY_REVIEWED";

  statusCode = 409;

  constructor(message = AlreadyReviewedError.defaultMessage, options = {}) {
    super(message, options);
  }
}

class InvalidStatusTransitionError extends ExceptionBase {
  static defaultMessage = "Đơn không ở trạng thái phù hợp cho hành động này";

  code = "REQUEST.INVALID_STATUS_TRANSITION";

  statusCode = 409;

  constructor(message = InvalidStatusTransitionError.defaultMessage, options = {}) {
    super(message, options);
  }
}

class RequestNotFoundError extends ExceptionBase {
  static defaultMessage = "Đơn không tồn tại";

  code = "REQUEST.NOT_FOUND";

  statusCode = 404;

  constructor(message = RequestNotFoundError.defaultMessage, options = {}) {
    super(message, options);
  }
}

module.exports = {
  CannotSelfReviewError,
  AlreadyReviewedError,
  InvalidStatusTransitionError,
  RequestNotFoundError
};

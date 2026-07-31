/* eslint-disable max-classes-per-file */
const {
  ForbiddenException,
  ConflictException,
  NotFoundException
} = require("../../../core/exceptions/exceptions");

class CannotSelfReviewError extends ForbiddenException {
  static defaultMessage = "Không thể tự duyệt đơn của mình";

  code = "REQUEST.CANNOT_SELF_REVIEW";

  constructor(message = CannotSelfReviewError.defaultMessage, options = {}) {
    super(message, options);
  }
}

class AlreadyReviewedError extends ConflictException {
  static defaultMessage = "Bạn đã duyệt đơn này rồi";

  code = "REQUEST.ALREADY_REVIEWED";

  constructor(message = AlreadyReviewedError.defaultMessage, options = {}) {
    super(message, options);
  }
}

class InvalidStatusTransitionError extends ConflictException {
  static defaultMessage = "Đơn không ở trạng thái phù hợp cho hành động này";

  code = "REQUEST.INVALID_STATUS_TRANSITION";

  constructor(message = InvalidStatusTransitionError.defaultMessage, options = {}) {
    super(message, options);
  }
}

class RequestNotFoundError extends NotFoundException {
  static defaultMessage = "Đơn không tồn tại";

  code = "REQUEST.NOT_FOUND";

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

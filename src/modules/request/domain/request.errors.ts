/* eslint-disable max-classes-per-file */
import {
  ForbiddenException,
  ConflictException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { ExceptionOptions } from "../../../core/exceptions/exception.base";

export class CannotSelfReviewError extends ForbiddenException {
  static defaultMessage = "Không thể tự duyệt đơn của mình";

  code = "REQUEST.CANNOT_SELF_REVIEW";

  constructor(
    message: string = CannotSelfReviewError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class AlreadyReviewedError extends ConflictException {
  static defaultMessage = "Bạn đã duyệt đơn này rồi";

  code = "REQUEST.ALREADY_REVIEWED";

  constructor(
    message: string = AlreadyReviewedError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class InvalidStatusTransitionError extends ConflictException {
  static defaultMessage = "Đơn không ở trạng thái phù hợp cho hành động này";

  code = "REQUEST.INVALID_STATUS_TRANSITION";

  constructor(
    message: string = InvalidStatusTransitionError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class RequestNotFoundError extends NotFoundException {
  static defaultMessage = "Đơn không tồn tại";

  code = "REQUEST.NOT_FOUND";

  constructor(
    message: string = RequestNotFoundError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

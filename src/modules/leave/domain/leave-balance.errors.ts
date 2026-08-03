/* eslint-disable max-classes-per-file */
import { ArgumentInvalidException, ConflictException } from "../../../core/exceptions/exceptions";
import { ExceptionOptions } from "../../../core/exceptions/exception.base";

export class InsufficientLeaveBalanceError extends ArgumentInvalidException {
  static defaultMessage = "Số dư phép không đủ để thực hiện điều chỉnh này";

  code = "LEAVE.INSUFFICIENT_BALANCE";

  constructor(
    message: string = InsufficientLeaveBalanceError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class LeaveLockTimeoutError extends ConflictException {
  static defaultMessage =
    "Hệ thống đang xử lý điều chỉnh phép khác cho nhân viên này, vui lòng thử lại";

  code = "LEAVE.LOCK_TIMEOUT";

  constructor(
    message: string = LeaveLockTimeoutError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

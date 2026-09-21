/* eslint-disable max-classes-per-file */
import {
  ForbiddenException,
  ConflictException,
  ArgumentInvalidException
} from "../../../core/exceptions/exceptions";
import { ExceptionOptions } from "../../../core/exceptions/exception.base";

export class InvalidRoleCodeFormatError extends ArgumentInvalidException {
  static defaultMessage =
    "Mã vai trò không hợp lệ — chỉ được chứa chữ cái viết hoa (A-Z), số (0-9) và dấu gạch dưới (_)";

  code = "PERMISSION.INVALID_ROLE_CODE_FORMAT";

  constructor(
    message: string = InvalidRoleCodeFormatError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class DuplicateRoleCodeError extends ConflictException {
  static defaultMessage = "Mã vai trò đã tồn tại trên hệ thống";

  code = "PERMISSION.DUPLICATE_ROLE_CODE";

  constructor(
    message: string = DuplicateRoleCodeError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class DuplicatePolicyCodeError extends ConflictException {
  static defaultMessage = "Mã policy đã tồn tại trên hệ thống";

  code = "PERMISSION.DUPLICATE_POLICY_CODE";

  constructor(
    message: string = DuplicatePolicyCodeError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class SystemRoleNotDeletableError extends ForbiddenException {
  static defaultMessage = "Không được phép xóa Vai trò hệ thống, chỉ được sửa quyền bên trong";

  code = "PERMISSION.SYSTEM_ROLE_NOT_DELETABLE";

  constructor(
    message: string = SystemRoleNotDeletableError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class SystemPolicyNotMutableError extends ForbiddenException {
  static defaultMessage = "Không được phép sửa hoặc xóa Policy hệ thống";

  code = "PERMISSION.SYSTEM_POLICY_NOT_MUTABLE";

  constructor(
    message: string = SystemPolicyNotMutableError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class PolicyInUseError extends ConflictException {
  static defaultMessage = "Policy đang được ít nhất 1 Vai trò sử dụng, không thể xóa";

  code = "PERMISSION.POLICY_IN_USE";

  constructor(message: string = PolicyInUseError.defaultMessage, options: ExceptionOptions = {}) {
    super(message, options);
  }
}

export class InvalidAttributePathError extends ArgumentInvalidException {
  static defaultMessage = "Điều kiện tham chiếu attribute path không hợp lệ";

  code = "PERMISSION.INVALID_ATTRIBUTE_PATH";

  constructor(
    message: string = InvalidAttributePathError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

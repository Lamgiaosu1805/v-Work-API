/* eslint-disable max-classes-per-file */
import {
  ArgumentInvalidException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { ExceptionOptions } from "../../../core/exceptions/exception.base";

export class TicketNotFoundError extends NotFoundException {
  static defaultMessage = "Ticket không tồn tại";

  code = "TICKET.NOT_FOUND";

  constructor(message: string = TicketNotFoundError.defaultMessage, options: ExceptionOptions = {}) {
    super(message, options);
  }
}

export class TicketForbiddenError extends ForbiddenException {
  static defaultMessage = "Bạn không có quyền thực hiện thao tác này trên ticket";

  code = "TICKET.FORBIDDEN";

  constructor(
    message: string = TicketForbiddenError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketInvalidTransitionError extends ConflictException {
  static defaultMessage = "Ticket không ở trạng thái phù hợp cho thao tác này";

  code = "TICKET.INVALID_STATUS_TRANSITION";

  constructor(
    message: string = TicketInvalidTransitionError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketAlreadyClaimedError extends ConflictException {
  static defaultMessage = "Ticket đã có người nhận xử lý";

  code = "TICKET.ALREADY_CLAIMED";

  constructor(
    message: string = TicketAlreadyClaimedError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketNotEligibleError extends ForbiddenException {
  static defaultMessage = "Ticket này đã được giao cho người khác, bạn không thể nhận";

  code = "TICKET.NOT_ELIGIBLE";

  constructor(
    message: string = TicketNotEligibleError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketVersionConflictError extends ConflictException {
  static defaultMessage = "Ticket vừa được người khác cập nhật, vui lòng tải lại để xem";

  code = "TICKET.VERSION_CONFLICT";

  constructor(
    message: string = TicketVersionConflictError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketApprovalRequiredError extends ConflictException {
  static defaultMessage = "Ticket cần tờ trình hợp lệ trước khi kết luận đã giải quyết";

  code = "TICKET.APPROVAL_REQUIRED";

  constructor(
    message: string = TicketApprovalRequiredError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketReopenNotAllowedError extends ConflictException {
  static defaultMessage = "Ticket không thể mở lại, vui lòng tạo ticket mới";

  code = "TICKET.REOPEN_NOT_ALLOWED";

  constructor(
    message: string = TicketReopenNotAllowedError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

export class TicketNoteRequiredError extends ArgumentInvalidException {
  static defaultMessage = "Vui lòng nhập ghi chú cho thao tác này";

  code = "TICKET.NOTE_REQUIRED";

  constructor(
    message: string = TicketNoteRequiredError.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

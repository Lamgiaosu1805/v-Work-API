/* eslint-disable max-classes-per-file  */
import { ExceptionBase, ExceptionOptions } from "./exception.base";

export class ArgumentInvalidException extends ExceptionBase {
  code = "GENERIC.ARGUMENT_INVALID";

  statusCode = 400;
}

export class ArgumentNotProvidedException extends ExceptionBase {
  code = "GENERIC.ARGUMENT_NOT_PROVIDED";

  statusCode = 400;
}

export class ArgumentOutOfRangeException extends ExceptionBase {
  code = "GENERIC.ARGUMENT_OUT_OF_RANGE";

  statusCode = 400;
}

export class ConflictException extends ExceptionBase {
  code = "GENERIC.CONFLICT";

  statusCode = 409;
}

export class ForbiddenException extends ExceptionBase {
  static defaultMessage = "Forbidden";

  code = "GENERIC.FORBIDDEN";

  statusCode = 403;

  constructor(message: string = ForbiddenException.defaultMessage, options: ExceptionOptions = {}) {
    super(message, options);
  }
}

export class NotFoundException extends ExceptionBase {
  static defaultMessage = "Not found";

  code = "GENERIC.NOT_FOUND";

  statusCode = 404;

  constructor(message: string = NotFoundException.defaultMessage, options: ExceptionOptions = {}) {
    super(message, options);
  }
}

export class InternalServerErrorException extends ExceptionBase {
  static defaultMessage = "Internal server error";

  code = "GENERIC.INTERNAL_SERVER_ERROR";

  statusCode = 500;

  constructor(
    message: string = InternalServerErrorException.defaultMessage,
    options: ExceptionOptions = {}
  ) {
    super(message, options);
  }
}

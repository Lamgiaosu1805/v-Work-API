/* eslint-disable max-classes-per-file  */
const { ExceptionBase } = require("./exception.base");

class ArgumentInvalidException extends ExceptionBase {
  code = "GENERIC.ARGUMENT_INVALID";

  statusCode = 400;
}

class ArgumentNotProvidedException extends ExceptionBase {
  code = "GENERIC.ARGUMENT_NOT_PROVIDED";

  statusCode = 400;
}

class ArgumentOutOfRangeException extends ExceptionBase {
  code = "GENERIC.ARGUMENT_OUT_OF_RANGE";

  statusCode = 400;
}

class ConflictException extends ExceptionBase {
  code = "GENERIC.CONFLICT";

  statusCode = 409;
}

class ForbiddenException extends ExceptionBase {
  static defaultMessage = "Forbidden";

  code = "GENERIC.FORBIDDEN";

  statusCode = 403;

  constructor(message = ForbiddenException.defaultMessage, options = {}) {
    super(message, options);
  }
}

class NotFoundException extends ExceptionBase {
  static defaultMessage = "Not found";

  code = "GENERIC.NOT_FOUND";

  statusCode = 404;

  constructor(message = NotFoundException.defaultMessage, options = {}) {
    super(message, options);
  }
}

class InternalServerErrorException extends ExceptionBase {
  static defaultMessage = "Internal server error";

  code = "GENERIC.INTERNAL_SERVER_ERROR";

  statusCode = 500;

  constructor(message = InternalServerErrorException.defaultMessage, options = {}) {
    super(message, options);
  }
}

module.exports = {
  ArgumentInvalidException,
  ArgumentNotProvidedException,
  ArgumentOutOfRangeException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException
};

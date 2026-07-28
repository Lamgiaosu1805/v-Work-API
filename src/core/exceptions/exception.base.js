class ExceptionBase extends Error {
  constructor(message, { cause, metadata } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    this.metadata = metadata;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      stack: this.stack,
      cause: this.cause ? String(this.cause) : undefined,
      metadata: this.metadata
    };
  }
}

module.exports = { ExceptionBase };

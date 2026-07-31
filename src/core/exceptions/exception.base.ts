export interface ExceptionOptions {
  cause?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ExceptionJSON {
  message: string;
  code: string;
  statusCode: number;
  stack?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export abstract class ExceptionBase extends Error {
  abstract readonly code: string;

  abstract readonly statusCode: number;

  readonly metadata?: Record<string, unknown>;

  constructor(message: string, { cause, metadata }: ExceptionOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    this.metadata = metadata;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): ExceptionJSON {
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

import { Request, Response, NextFunction } from "express";
import { sendExceptionResponse } from "./handle-exception";
import { ExceptionBase } from "../exceptions/exception.base";
import { logger } from "../../config/logger";

export function errorHandlerMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (!(err instanceof ExceptionBase) || err.statusCode >= 500) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message, { stack: err instanceof Error ? err.stack : undefined });
  }
  sendExceptionResponse(res, err);
}

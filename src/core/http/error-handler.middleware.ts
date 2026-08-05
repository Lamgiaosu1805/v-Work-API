import { Request, Response, NextFunction } from "express";
import { sendExceptionResponse } from "./handle-exception";

export function errorHandlerMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  sendExceptionResponse(res, err);
}

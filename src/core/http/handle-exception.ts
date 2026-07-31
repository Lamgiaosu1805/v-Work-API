import { Response } from "express";
import { ExceptionBase } from "../exceptions/exception.base";

export function sendExceptionResponse(res: Response, error: unknown): Response {
  if (error instanceof ExceptionBase) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(500).json({ message: "Lỗi server", error: message });
}

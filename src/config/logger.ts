import { RequestContextService } from "../core/context/request-context";

const IS_PROD = process.env.NODE_ENV === "production";

function print(level: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const requestId = RequestContextService.getRequestId();
  const requestIdPart = requestId ? ` [${requestId}]` : "";
  const prefix = `[${timestamp}] [${level}]${requestIdPart} ${message}`;
  const args: unknown[] = meta ? [prefix, meta] : [prefix];
  if (level === "ERROR" || level === "WARN") {
    console.error(...args);
  } else {
    console.log(...args);
  }
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    print("INFO", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    print("WARN", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    print("ERROR", message, meta);
  },
  debug(message: string, meta?: Record<string, unknown>): void {
    if (!IS_PROD) print("DEBUG", message, meta);
  }
};

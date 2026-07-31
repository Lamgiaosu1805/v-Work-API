import { RequestContextService } from "../core/context/request-context";

const IS_PROD = process.env.NODE_ENV === "production";

function serializeMeta(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta không serialize được]";
  }
}

function print(level: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const requestId = RequestContextService.getRequestId();
  const requestIdPart = requestId ? ` [${requestId}]` : "";
  const line = `[${timestamp}] [${level}]${requestIdPart} ${message}${serializeMeta(meta)}`;
  if (level === "ERROR" || level === "WARN") {
    console.error(line);
  } else {
    console.log(line);
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

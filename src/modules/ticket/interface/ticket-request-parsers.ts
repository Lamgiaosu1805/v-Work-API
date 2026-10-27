import { Request } from "express";
import path from "path";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { UploadedTicketFile } from "../application/ticket-commands.service";
import { normalizeScope, TICKET_TABS, TicketListQuery } from "../application/ticket-query-filters";
import { TICKET_URGENCIES } from "../domain/types";

// Phần của đối tượng file mà multer gắn vào req.files (dự án không cài @types/multer).
interface MulterFileLike {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
}

// Đọc/kiểm tra dữ liệu request (thuần, không đụng DB) — controller chỉ việc gọi.

// Request multipart gửi JSON trong field "payload" (kèm file); request JSON thường dùng thẳng body.
export function readPayload(req: Request): Record<string, any> {
  const body = (req.body ?? {}) as Record<string, any>;
  if (typeof body.payload === "string") {
    try {
      const parsed = JSON.parse(body.payload);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      throw new ArgumentInvalidException("Dữ liệu gửi lên không đúng định dạng JSON");
    }
    throw new ArgumentInvalidException("Dữ liệu gửi lên không hợp lệ");
  }
  return body;
}

export function toDate(value: unknown, name = "Ngày"): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new ArgumentInvalidException(`${name} không hợp lệ`);
  return date;
}

export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

// File multer → UploadedTicketFile. Loại giấy tờ của từng file nằm trong payload.fileKinds (cùng thứ tự).
export function readUploadedFiles(
  req: Request,
  payload: Record<string, any>
): UploadedTicketFile[] {
  const files = (req as unknown as { files?: MulterFileLike[] }).files ?? [];
  const kinds: unknown[] = Array.isArray(payload.fileKinds) ? payload.fileKinds : [];
  return files.map((file, index) => ({
    // Tên gốc từ client có thể chứa đường dẫn → chỉ giữ tên file
    originalName: path.basename(Buffer.from(file.originalname, "latin1").toString("utf8")),
    storedName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    kind: typeof kinds[index] === "string" && kinds[index] ? String(kinds[index]) : "other"
  }));
}

export function parseListQuery(query: Request["query"]): TicketListQuery {
  const tab =
    typeof query.tab === "string" && (TICKET_TABS as readonly string[]).includes(query.tab)
      ? query.tab
      : undefined;
  const urgency =
    typeof query.urgency === "string" &&
    (TICKET_URGENCIES as readonly string[]).includes(query.urgency)
      ? query.urgency
      : undefined;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  return {
    tab,
    scope: tab ? normalizeScope(tab, text(query.scope)) : undefined,
    status: toStringList(query.status),
    productId: text(query.productId),
    categoryId: text(query.categoryId),
    templateId: text(query.templateId),
    urgency,
    ownerId: text(query.ownerId),
    q: text(query.q),
    from: toDate(query.from, "Từ ngày") ?? undefined,
    to: toDate(query.to, "Đến ngày") ?? undefined,
    page: Number(query.page),
    limit: Number(query.limit)
  };
}

// Content-Type theo đuôi file (KHÔNG tin mimetype do client khai) — chỉ định dạng an toàn mới xem trực tiếp trong trình duyệt, còn lại buộc tải về.
const INLINE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".heic": "image/heic"
};

export function contentTypeFor(fileName: string): { type: string; inline: boolean } {
  const type = INLINE_TYPES[path.extname(fileName).toLowerCase()];
  return type ? { type, inline: true } : { type: "application/octet-stream", inline: false };
}

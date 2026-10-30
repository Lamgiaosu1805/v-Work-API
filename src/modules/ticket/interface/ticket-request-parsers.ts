import { Request } from "express";
import mongoose from "mongoose";
import path from "path";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { UploadedTicketFile } from "../application/ticket-commands.service";
import { normalizeScope, TICKET_TABS, TicketListQuery } from "../application/ticket-query-filters";
import {
  TICKET_RESOLUTIONS,
  TICKET_URGENCIES,
  TicketResolutionCode,
  TicketUrgency
} from "../domain/types";

// Phần của đối tượng file mà multer gắn vào req.files (dự án không cài @types/multer).
interface MulterFileLike {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
}

// Đọc/kiểm tra dữ liệu request (thuần, không đụng DB) — controller chỉ việc gọi.

// Các trường chữ mà domain gọi .trim() — gửi số / mảng / đối tượng vào đây sẽ thành lỗi 500, nên chặn ở cổng là 400.
const TEXT_FIELDS = ["note", "reason", "description", "title", "body", "actionTaken"];

function assertTextFields(payload: Record<string, any>): void {
  const check = (container: Record<string, any> | null | undefined, key: string) => {
    const value = container?.[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new ArgumentInvalidException(`Trường "${key}" phải là chuỗi ký tự`);
    }
  };
  TEXT_FIELDS.forEach((key) => check(payload, key));
  check(payload.followUp, "note");
}

// Request multipart gửi JSON trong field "payload" (kèm file); request JSON thường dùng thẳng body.
export function readPayload(req: Request): Record<string, any> {
  const body = (req.body ?? {}) as Record<string, any>;
  let payload: Record<string, any> = body;
  if (typeof body.payload === "string") {
    try {
      const parsed = JSON.parse(body.payload);
      if (!parsed || typeof parsed !== "object") {
        throw new ArgumentInvalidException("Dữ liệu gửi lên không hợp lệ");
      }
      payload = parsed;
    } catch (error) {
      if (error instanceof ArgumentInvalidException) throw error;
      throw new ArgumentInvalidException("Dữ liệu gửi lên không đúng định dạng JSON");
    }
  }
  assertTextFields(payload);
  return payload;
}

export function toDate(value: unknown, name = "Ngày"): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new ArgumentInvalidException(`${name} không hợp lệ`);
  return date;
}

// Version ticket mà client đang hiển thị (không gửi = bỏ qua kiểm tra, để client cũ vẫn chạy).
export function toVersion(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new ArgumentInvalidException("Phiên bản ticket không hợp lệ");
  }
  return version;
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

// ---- id / enum từ client: kiểm tra ở rìa HTTP để không lọt xuống Mongoose (CastError → 500 lộ message thô) ----

// Chỉ nhận chuỗi ObjectId 24 hex (isValidObjectId một mình còn chấp nhận số và chuỗi 12 ký tự).
export const isObjectIdString = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value) && mongoose.isValidObjectId(value);

// Bắt buộc có id hợp lệ: thiếu → 400 với message của nơi gọi ("Vui lòng chọn sản phẩm"), sai định dạng → 400 "không hợp lệ".
export function requireObjectId(
  value: unknown,
  missingMessage: string,
  invalidMessage?: string
): string {
  if (value === undefined || value === null || value === "") {
    throw new ArgumentInvalidException(missingMessage);
  }
  if (!isObjectIdString(value)) {
    throw new ArgumentInvalidException(invalidMessage ?? missingMessage);
  }
  return value;
}

// Id tuỳ chọn: không gửi / null / "" → undefined (web gửi "" cho ô chưa chọn); có giá trị mà sai định dạng → 400.
export function optionalObjectId(value: unknown, invalidMessage: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isObjectIdString(value)) throw new ArgumentInvalidException(invalidMessage);
  return value;
}

// Danh sách id (mảng hoặc chuỗi "a,b"): mọi phần tử phải là ObjectId hợp lệ.
export function toObjectIdList(value: unknown, invalidMessage: string): string[] {
  const list = toStringList(value);
  if (list.some((id) => !isObjectIdString(id))) throw new ArgumentInvalidException(invalidMessage);
  return list;
}

// Mức khẩn tuỳ chọn: không gửi → undefined; gửi mà không thuộc danh sách → 400.
export function optionalUrgency(value: unknown): TicketUrgency | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(TICKET_URGENCIES as readonly string[]).includes(value)) {
    throw new ArgumentInvalidException("Mức khẩn không hợp lệ");
  }
  return value as TicketUrgency;
}

// Kết quả đóng ticket: bắt buộc và phải thuộc danh sách (requester_no_response do domain chặn riêng vì chỉ hệ thống được đặt).
export function requireResolutionCode(value: unknown): TicketResolutionCode {
  if (value === undefined || value === null || value === "") {
    throw new ArgumentInvalidException("Vui lòng chọn kết quả đóng ticket");
  }
  if (typeof value !== "string" || !(TICKET_RESOLUTIONS as readonly string[]).includes(value)) {
    throw new ArgumentInvalidException("Kết quả đóng ticket không hợp lệ");
  }
  return value as TicketResolutionCode;
}

// Khách hàng gắn ticket: giữ nguyên đối tượng client gửi, chỉ kiểm tra customerId (nếu có) là ObjectId.
export function checkCustomerRef<T>(customer: T): T {
  if (customer && typeof customer === "object") {
    optionalObjectId((customer as Record<string, unknown>).customerId, "Khách hàng không hợp lệ");
  }
  return customer;
}

// Phần giao việc ({ mode, departmentId, memberIds, ownerId }): giữ nguyên hình dạng, chỉ kiểm tra các id.
export function checkAssignment<T>(assignment: T): T {
  if (assignment === undefined || assignment === null) return assignment;
  if (typeof assignment !== "object" || Array.isArray(assignment)) {
    throw new ArgumentInvalidException("Thông tin giao việc không hợp lệ");
  }
  const raw = assignment as Record<string, unknown>;
  optionalObjectId(raw.departmentId, "Phòng ban được giao không hợp lệ");
  optionalObjectId(raw.ownerId, "Người chủ trì không hợp lệ");
  return {
    ...raw,
    ...(raw.memberIds === undefined
      ? {}
      : { memberIds: toObjectIdList(raw.memberIds, "Danh sách người được giao không hợp lệ") })
  } as T;
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

function requireNoValue(value: unknown, message: string): undefined {
  if (value !== undefined) throw new ArgumentInvalidException(message);
  return undefined;
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

  // Bộ lọc id trên query string: "" = không lọc; mảng/đối tượng (?productId[$ne]=) hay sai định dạng → 400
  const queryId = (value: unknown, message: string) =>
    typeof value === "string"
      ? optionalObjectId(value.trim(), message)
      : requireNoValue(value, message);

  return {
    tab,
    scope: tab ? normalizeScope(tab, text(query.scope)) : undefined,
    status: toStringList(query.status),
    productId: queryId(query.productId, "Sản phẩm lọc không hợp lệ"),
    categoryId: queryId(query.categoryId, "Loại yêu cầu lọc không hợp lệ"),
    templateId: queryId(query.templateId, "Mẫu yêu cầu lọc không hợp lệ"),
    urgency,
    ownerId: queryId(query.ownerId, "Người xử lý lọc không hợp lệ"),
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

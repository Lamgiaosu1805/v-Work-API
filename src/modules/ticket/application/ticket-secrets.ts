import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

// Nội dung ẩn trong tin nhắn: người dùng gõ "/" → chọn "Nội dung ẩn". Văn bản gửi lên chứa dấu hiệu `⟦s:<khoá>⟧`
// kèm danh sách `secrets: [{ key, label?, value }]`. Server đổi khoá thành mã thật của bản ghi đã mã hoá, nên văn bản lưu
// ở DB (và mọi nơi đọc nó: thông báo, Trợ lý AI, danh sách) chỉ chứa dấu hiệu, không bao giờ chứa giá trị.

export const MAX_SECRETS_PER_MESSAGE = 5;
export const MAX_SECRET_LENGTH = 2000;
export const MAX_SECRET_LABEL_LENGTH = 60;
export const HIDDEN_TEXT = "[nội dung ẩn]";

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
// Dấu hiệu trong văn bản. Tạo mới mỗi lần dùng (cờ g giữ trạng thái lastIndex).
const markerPattern = () => /⟦s:([A-Za-z0-9_-]{1,32})⟧/g;

export interface PreparedSecret {
  id: string;
  label: string;
  value: string;
}

// Thay mọi dấu hiệu bằng chữ trung tính — dùng ở mọi nơi đưa văn bản ra ngoài trang chi tiết (thông báo đẩy, Trợ lý AI...).
export function maskSecretMarkers(text: string): string {
  return text.replace(markerPattern(), HIDDEN_TEXT);
}

// Kiểm tra `secrets` người dùng gửi, rồi đổi khoá tạm trong văn bản thành mã thật (do `newId` cấp). Dấu hiệu không có
// khai báo tương ứng bị từ chối (chặn giả dấu hiệu để trỏ vào nội dung ẩn của tin khác); khai báo mà văn bản không dùng
// thì bỏ đi.
export function prepareSecrets(
  text: string,
  rawSecrets: unknown,
  newId: () => string
): { text: string; secrets: PreparedSecret[] } {
  if (rawSecrets !== undefined && rawSecrets !== null && !Array.isArray(rawSecrets)) {
    throw new ArgumentInvalidException("Danh sách nội dung ẩn không hợp lệ");
  }
  const declared = new Map<string, { label: string; value: string }>();
  (rawSecrets ?? []).forEach((item: unknown) => {
    const { key, label, value } = (item ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
      throw new ArgumentInvalidException("Nội dung ẩn có khoá không hợp lệ");
    }
    if (declared.has(key)) throw new ArgumentInvalidException("Nội dung ẩn bị trùng khoá");
    if (typeof value !== "string" || !value.trim()) {
      throw new ArgumentInvalidException("Nội dung ẩn không được để trống");
    }
    if (value.length > MAX_SECRET_LENGTH) {
      throw new ArgumentInvalidException(`Nội dung ẩn dài tối đa ${MAX_SECRET_LENGTH} ký tự`);
    }
    if (label !== undefined && label !== null && typeof label !== "string") {
      throw new ArgumentInvalidException("Nhãn nội dung ẩn phải là chuỗi ký tự");
    }
    const cleanLabel = (label ?? "").trim();
    if (cleanLabel.length > MAX_SECRET_LABEL_LENGTH) {
      throw new ArgumentInvalidException(
        `Nhãn nội dung ẩn dài tối đa ${MAX_SECRET_LABEL_LENGTH} ký tự`
      );
    }
    declared.set(key, { label: cleanLabel, value });
  });

  const used = new Map<string, PreparedSecret>();
  const rewritten = text.replace(markerPattern(), (_marker, key: string) => {
    const secret = declared.get(key);
    if (!secret) throw new ArgumentInvalidException("Nội dung chứa dấu hiệu ẩn không hợp lệ");
    if (!used.has(key)) {
      if (used.size >= MAX_SECRETS_PER_MESSAGE) {
        throw new ArgumentInvalidException(
          `Mỗi tin nhắn chỉ có tối đa ${MAX_SECRETS_PER_MESSAGE} nội dung ẩn`
        );
      }
      used.set(key, { id: newId(), ...secret });
    }
    return `⟦s:${used.get(key)!.id}⟧`;
  });
  return { text: rewritten, secrets: [...used.values()] };
}

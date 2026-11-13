import crypto from "crypto";
import { InternalServerErrorException } from "../../../core/exceptions/exceptions";

// Mã hoá nội dung ẩn của ticket bằng AES-256-GCM. Khoá RIÊNG `TICKET_SECRET_KEY` (xem loadKey) — không dùng chung với khoá khác. Thiếu / sai khoá thì TỪ CHỐI hoạt động (không bao giờ lưu rõ). `aad` (mã ticket) ràng
// bản mã vào đúng ticket: chép bản mã sang ticket khác sẽ không giải mã được.

export interface EncryptedSecret {
  iv: string;
  tag: string;
  cipher: string;
}

// `TICKET_SECRET_KEY` có hai dạng:
//   - 64 ký tự hex: dùng thẳng làm khoá 32 byte (vd `openssl rand -hex 32`).
//   - Chuỗi bất kỳ dài từ MIN_PASSPHRASE_LENGTH ký tự (vd `PROD_<chuỗi ngẫu nhiên dài>`, có thể có tiền tố môi trường): băm
//     scrypt (muối cố định) ra khoá 32 byte. Cùng chuỗi → cùng khoá nên đổi chuỗi là mất khả năng giải mã nội dung cũ.
// Chuỗi càng ngẫu nhiên càng tốt — đừng dùng câu dễ đoán. Nên dùng chữ không dấu (tránh lỗi mã hoá ký tự ở biến môi trường).
export const MIN_PASSPHRASE_LENGTH = 32;
const PASSPHRASE_SALT = "vwork-ticket-secret-v1";

let cachedKey: { raw: string; key: Buffer } | null = null;

function loadKey(): Buffer {
  const raw = (process.env.TICKET_SECRET_KEY ?? "").trim();
  if (!raw) {
    throw new InternalServerErrorException(
      "Tính năng nội dung ẩn chưa được cấu hình (thiếu TICKET_SECRET_KEY)"
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < MIN_PASSPHRASE_LENGTH) {
    throw new InternalServerErrorException(
      `TICKET_SECRET_KEY quá ngắn (tối thiểu ${MIN_PASSPHRASE_LENGTH} ký tự, hoặc 64 ký tự hex)`
    );
  }
  // scrypt chạy chậm có chủ đích nên chỉ tính một lần cho mỗi giá trị khoá
  if (cachedKey?.raw !== raw) {
    cachedKey = { raw, key: crypto.scryptSync(raw, PASSPHRASE_SALT, 32) };
  }
  return cachedKey.key;
}

export function encryptSecret(plain: string, aad: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    cipher: data.toString("base64")
  };
}

export function decryptSecret(encrypted: EncryptedSecret, aad: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    loadKey(),
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.cipher, "base64")),
    decipher.final()
  ]).toString("utf8");
}

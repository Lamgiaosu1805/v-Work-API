const crypto = require("crypto");

const DEFAULT_TTL_SECONDS = Number(process.env.FILE_URL_TTL) || 7 * 24 * 60 * 60;

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.SECRET_KEY_DECRYPT;
  if (!secret) {
    throw new Error("SECRET_KEY_DECRYPT chưa được cấu hình — không thể mã hóa URL file");
  }
  cachedKey = crypto.createHash("sha256").update(secret).digest();
  return cachedKey;
}

const REFRESH_WINDOW = 24 * 60 * 60;

function normalizePath(relativePath) {
  return String(relativePath).replace(/^\/+/, "");
}

function deriveIv(payload) {
  return crypto.createHmac("sha256", getKey()).update(`iv:${payload}`).digest().subarray(0, 12);
}

function encryptFilePath(relativePath, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!relativePath) return null;
  const exp = Math.floor(Date.now() / 1000 / REFRESH_WINDOW) * REFRESH_WINDOW + ttlSeconds;
  const payload = JSON.stringify({ p: normalizePath(relativePath), e: exp });

  const iv = deriveIv(payload);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

function decryptFileToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");

    const { p, e } = JSON.parse(plain);
    if (!p || !e) return null;
    if (Math.floor(Date.now() / 1000) > Number(e)) return null;

    return { path: normalizePath(p) };
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  encryptFilePath,
  decryptFileToken
};

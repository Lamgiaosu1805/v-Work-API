const crypto = require("crypto");

const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  const combined = Buffer.from(encryptedText, "base64");

  const iv = combined.slice(0, 12);
  const authTag = combined.slice(combined.length - 16);
  const encrypted = combined.slice(12, combined.length - 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.SECRET_KEY_DECRYPT),
    iv,
  );

  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
};

module.exports = {
  decrypt,
};

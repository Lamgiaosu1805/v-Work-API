const path = require("path");
const fs = require("fs");
const { decryptFileToken } = require("../helpers/fileSignature");

function getPublicDir() {
  return process.env.NODE_ENV === "production"
    ? process.env.UPLOAD_DIR_PUBLIC_PROD
    : process.env.UPLOAD_DIR_PUBLIC_DEV;
}

function resolveWithinBase(baseDir, relativePath) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return null;
  }
  return resolved;
}

function serveEncryptedFile(req, res) {
  const decoded = decryptFileToken(req.params.token);
  if (!decoded) {
    return res.status(403).json({ message: "Link không hợp lệ hoặc đã hết hạn" });
  }

  const filePath = resolveWithinBase(getPublicDir(), decoded.path);
  if (!filePath) {
    return res.status(403).json({ message: "Đường dẫn không hợp lệ" });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Không tìm thấy file" });
  }

  return res.sendFile(filePath, {
    maxAge: "7d",
    headers: { "Cache-Control": "private, max-age=604800" }
  });
}

module.exports = { serveEncryptedFile };

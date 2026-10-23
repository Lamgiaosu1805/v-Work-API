const multer = require("multer");
const path = require("path");
const fs = require("fs");

// File đính kèm của ticket (ảnh lỗi, CCCD, chứng từ, tờ trình...). Lưu ở thư mục RIÊNG TƯ, không qua
// /static; chỉ tải về qua API có kiểm tra quyền (GET /tickets/:id/attachments/:attachmentId/download).
// Tên file lưu đĩa do server sinh = {timestamp}-{random}{ext}; tên gốc lưu trong DB.

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 10;

// Chỉ nhận định dạng an toàn để xem lại (không HTML/SVG/script — tránh stored XSS khi mở trên origin API).
const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".mp4",
  ".mov"
]);

function getTicketDir() {
  const dir =
    process.env.NODE_ENV === "production"
      ? process.env.TICKET_DIR_PROD
      : process.env.TICKET_DIR_DEV;
  return path.resolve(dir || path.join("uploads", "ticket"));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = getTicketDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, suffix + path.extname(file.originalname).toLowerCase());
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`Loại file "${ext || "không xác định"}" không được phép đính kèm`), false);
  }
  cb(null, true);
};

const uploader = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES }
});

// Nhận tối đa 10 file ở field "files" (tuỳ chọn). Lỗi upload trả 400/413 JSON thay vì lỗi 500.
function uploadTicketFiles(req, res, next) {
  uploader.array("files", MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Mỗi file không được vượt quá 25MB" });
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: `Chỉ đính kèm tối đa ${MAX_FILES} file mỗi lần` });
    }
    return res.status(400).json({ message: err.message || "Không tải được file đính kèm" });
  });
}

module.exports = { uploadTicketFiles, getTicketDir, ALLOWED_EXTENSIONS };

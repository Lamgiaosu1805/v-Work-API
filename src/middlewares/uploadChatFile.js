const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { getChatDir } = require("./uploadChatImage");

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const BLOCKED_FILE_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".msi",
  ".dll",
  ".com",
  ".scr",
  ".ps1",
  ".jar",
  ".apk"
]);

const chatFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const chatDir = getChatDir(req.params.conversationId);
    fs.mkdirSync(chatDir, { recursive: true });
    cb(null, chatDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueSuffix + ext);
  }
});

const chatFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_FILE_EXTENSIONS.has(ext)) {
    return cb(new Error("Loại file này không được phép gửi"), false);
  }
  cb(null, true);
};

const uploadChatFile = multer({
  storage: chatFileStorage,
  fileFilter: chatFileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

function wrapUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(400)
            .json({ message: "File vượt quá dung lượng cho phép (tối đa 5MB)" });
        }
        return res.status(400).json({ message: "Upload file thất bại: " + err.message });
      }

      return res.status(400).json({ message: err.message || "File không hợp lệ" });
    });
  };
}

module.exports = { uploadChatFile, wrapUpload, MAX_FILE_SIZE };

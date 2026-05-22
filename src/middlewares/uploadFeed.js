const multer = require("multer");
const path = require("path");
const fs = require("fs");

const ALLOWED_MIMETYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];

const getFeedDir = () => {
  const baseDir =
    process.env.NODE_ENV === "production"
      ? process.env.UPLOAD_DIR_PROD
      : process.env.UPLOAD_DIR_DEV;
  return path.resolve(baseDir, "feed");
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const feedDir = getFeedDir();
    fs.mkdirSync(feedDir, { recursive: true });
    cb(null, feedDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh (jpg, jpeg, png, gif, webp)"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB mỗi file
    files: 4,
  },
});

module.exports = upload;

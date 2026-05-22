const multer = require("multer");
const path = require("path");
const fs = require("fs");
const heicConvert = require("heic-convert");

const ALLOWED_MIMETYPES = [
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
];

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

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
    // Save HEIC directly as .jpg — we'll overwrite with converted bytes after upload
    const ext = HEIC_TYPES.has(file.mimetype) ? ".jpg" : path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh (jpg, jpeg, png, gif, webp, heic)"), false);
  }
};

// Runs after multer — converts any HEIC files to JPEG in-place
async function convertHeic(req, _res, next) {
  if (!req.files?.length) return next();

  try {
    await Promise.all(
      req.files.map(async (file) => {
        if (!HEIC_TYPES.has(file.mimetype)) return;
        const inputBuffer = fs.readFileSync(file.path);
        const outputBuffer = await heicConvert({ buffer: inputBuffer, format: "JPEG", quality: 0.85 });
        fs.writeFileSync(file.path, Buffer.from(outputBuffer));
        file.mimetype = "image/jpeg";
      })
    );
    next();
  } catch (err) {
    next(new Error("Không thể xử lý file HEIC: " + err.message));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 4,
  },
});

module.exports = { upload, convertHeic };

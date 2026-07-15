const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const heicConvert = require("heic-convert");

const ALLOWED_MIMETYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif"
];

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const GIF_TYPES = new Set(["image/gif"]);

const getFeedDir = () => {
  // Ảnh feed là file công khai → lưu vào thư mục public, serve qua /static.
  const baseDir =
    process.env.NODE_ENV === "production"
      ? process.env.UPLOAD_DIR_PUBLIC_PROD
      : process.env.UPLOAD_DIR_PUBLIC_DEV;
  return path.resolve(baseDir, "feed");
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const feedDir = getFeedDir();
    fs.mkdirSync(feedDir, { recursive: true });
    cb(null, feedDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = GIF_TYPES.has(file.mimetype) ? ".gif" : ".webp";
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh (jpg, png, gif, webp, heic)"), false);
  }
};

async function processImages(req, _res, next) {
  let files = [];
  if (req.files?.length) {
    files = req.files;
  } else if (req.file) {
    files = [req.file];
  }

  if (!files.length) return next();

  try {
    await Promise.all(
      files.map(async (file) => {
        if (GIF_TYPES.has(file.mimetype)) return;

        let inputBuffer;

        if (HEIC_TYPES.has(file.mimetype)) {
          const heicBuffer = fs.readFileSync(file.path);
          const converted = await heicConvert({ buffer: heicBuffer, format: "JPEG", quality: 1 });
          inputBuffer = Buffer.from(converted);
        } else {
          inputBuffer = fs.readFileSync(file.path);
        }

        await sharp(inputBuffer)
          .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(`${file.path}.tmp`);

        fs.renameSync(`${file.path}.tmp`, file.path);
        file.mimetype = "image/webp";
      })
    );
    next();
  } catch (err) {
    next(new Error(`Không thể xử lý ảnh: ${err.message}`));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 20
  }
});

module.exports = { upload, processImages };

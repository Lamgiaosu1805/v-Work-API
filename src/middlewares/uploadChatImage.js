const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const heicConvert = require("heic-convert");

const ALLOWED_MIMETYPES = [
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
];

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const GIF_TYPES = new Set(["image/gif"]);

const THUMBNAIL_SUFFIX = "-thumb";

const getChatDir = (conversationId) => {
  const baseDir =
    process.env.NODE_ENV === "production"
      ? process.env.UPLOAD_DIR_PROD
      : process.env.UPLOAD_DIR_DEV;
  return path.resolve(baseDir, "chat", String(conversationId));
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const chatDir = getChatDir(req.params.conversationId);
    fs.mkdirSync(chatDir, { recursive: true });
    cb(null, chatDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = GIF_TYPES.has(file.mimetype) ? ".gif" : ".webp";
    cb(null, uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh (jpg, png, gif, webp, heic)"), false);
  }
};

async function processChatImage(req, res, next) {
  if (!req.file) return next();

  const { file } = req;

  try {
    let inputBuffer;

    if (HEIC_TYPES.has(file.mimetype)) {
      const heicBuffer = fs.readFileSync(file.path);
      const converted = await heicConvert({ buffer: heicBuffer, format: "JPEG", quality: 1 });
      inputBuffer = Buffer.from(converted);
    } else {
      inputBuffer = fs.readFileSync(file.path);
    }

    if (GIF_TYPES.has(file.mimetype)) {
      const metadata = await sharp(inputBuffer).metadata();
      file.width = metadata.width ?? null;
      file.height = metadata.height ?? null;
      file.size = fs.statSync(file.path).size;
      return next();
    }

    const resized = sharp(inputBuffer).resize(1920, 1920, {
      fit: "inside",
      withoutEnlargement: true,
    });
    const { data: fullBuffer, info } = await resized.webp({ quality: 80 }).toBuffer({
      resolveWithObject: true,
    });
    fs.writeFileSync(file.path, fullBuffer);
    file.mimetype = "image/webp";
    file.width = info.width;
    file.height = info.height;
    file.size = fullBuffer.length;

    const thumbPath = file.path.replace(/\.webp$/, `${THUMBNAIL_SUFFIX}.webp`);
    await sharp(inputBuffer)
      .resize(320, 320, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(thumbPath);
    file.thumbnailFilename = path.basename(thumbPath);

    return next();
  } catch (err) {
    return next(new Error(`Không thể xử lý ảnh: ${err.message}`));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

module.exports = { upload, processChatImage, getChatDir };

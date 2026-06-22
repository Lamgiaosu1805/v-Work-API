const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Avatar và ảnh bìa là file công khai → lưu vào {public}/avatar, serve qua /static.
const publicBase =
  process.env.NODE_ENV === "production"
    ? process.env.UPLOAD_DIR_PUBLIC_PROD
    : process.env.UPLOAD_DIR_PUBLIC_DEV;
const AVATAR_DIR = path.resolve(publicBase, "avatar");
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Tiền tố lưu trong DB để FE ghép URL /static/<value>
upload.AVATAR_DIR = AVATAR_DIR;
upload.AVATAR_PREFIX = "avatar";

module.exports = upload;

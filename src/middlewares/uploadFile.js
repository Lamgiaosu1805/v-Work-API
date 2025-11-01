const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir =
  process.env.NODE_ENV === "production"
    ? process.env.UPLOAD_DIR_PROD || "/home/vwork/uploads"
    : process.env.UPLOAD_DIR_DEV || "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

module.exports = upload;
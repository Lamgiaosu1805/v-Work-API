const multer = require('multer');
const path = require('path');
const fs = require('fs');

let storage;

if (process.env.NODE_ENV === "production") {
  const uploadDir = process.env.UPLOAD_DIR_PROD;
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  });
} else {
  storage = multer.memoryStorage();
}

module.exports = multer({ storage });
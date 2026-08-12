const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DocumentTypeModel = require('../models/DocumentTypeModel');

const uploadDir =
  process.env.NODE_ENV === 'production' ? process.env.UPLOAD_DIR_PROD : process.env.UPLOAD_DIR_DEV;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

module.exports = async (req, res, next) => {
  try {
    const docTypes = await DocumentTypeModel.find({ isDeleted: false });
    const fields = docTypes.map((doc) => ({ name: doc._id.toString(), maxCount: 10 }));
    upload.fields(fields)(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

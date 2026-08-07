const multer = require("multer");
const path = require("path");
const fs = require("fs");
const SharedFolderModel = require("../models/SharedFolderModel");

const getBaseDir = () => {
  const dir =
    process.env.NODE_ENV === "production"
      ? process.env.SHARED_DIR_PROD
      : process.env.SHARED_DIR_DEV;
  return path.resolve(dir);
};

function getSharedFilePath(folderId, filename) {
  if (folderId) return path.join(getBaseDir(), folderId.toString(), filename);
  return path.join(getBaseDir(), filename);
}

const uploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "Kích thước mỗi file không được vượt quá 50MB"
      });
    }
  }

  next(err);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { folder_id } = req.body;

    const resolveDest = async () => {
      if (folder_id) {
        const folder = await SharedFolderModel.findById(folder_id);
        if (!folder || folder.isDeleted) {
          throw new Error("Thư mục không tồn tại");
        }
        return path.join(getBaseDir(), folder_id.toString());
      }
      return path.join(getBaseDir());
    };

    resolveDest()
      .then((destFolder) => {
        fs.mkdirSync(destFolder, { recursive: true });
        req._folderId = folder_id || null;
        cb(null, destFolder);
      })
      .catch(cb);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadShared = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

module.exports = { uploadShared, getSharedFilePath, uploadError };

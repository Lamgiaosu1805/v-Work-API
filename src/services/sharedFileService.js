const fs = require("fs");
const heicConvert = require("heic-convert");
const path = require("path");
const SharedFolderModel = require("../models/SharedFolderModel");
const SharedFileModel = require("../models/SharedFileModel");
const { getSharedFilePath } = require("../middlewares/uploadShared");
const { getFullNameMap } = require("../controllers/InternalFileController");
const { canDoFolderAction, canDoFileAction } = require("../helpers/shareFolderHelper");
const { safeUnlink } = require("./sharedFolderService");

const SharedFileService = {
  async getFilesByFolder(accountId, folderId) {
    const hasFolderId = folderId && folderId !== "null";
    const folderFilter = hasFolderId ? { folder_id: folderId } : { folder_id: { $in: [null] } };

    if (hasFolderId) {
      const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
      if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };
      if (!(await canDoFolderAction(accountId, folder, "view"))) {
        return { error: { status: 403, message: "Bạn không có quyền xem thư mục này" } };
      }
    }

    const files = await SharedFileModel.find({ isDeleted: false, ...folderFilter })
      .populate("uploadedBy", "username")
      .sort({ createdAt: -1 });

    const fullNameMap = await getFullNameMap(files.map((f) => f.uploadedBy?._id));
    const data = files.map((f) => {
      const obj = f.toJSON();
      if (obj.uploadedBy)
        obj.uploadedBy.full_name = fullNameMap[obj.uploadedBy._id?.toString()] || null;
      return obj;
    });

    return { data };
  },

  async uploadFiles(accountId, folderId, files) {
    const cleanup = () => files.forEach((f) => safeUnlink(f.path));

    if (!files || files.length === 0) {
      return { error: { status: 400, message: "Không có file được gửi lên" } };
    }

    if (folderId) {
      const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
      if (!folder) {
        cleanup();
        return { error: { status: 404, message: "Thư mục không tồn tại" } };
      }
      if (!(await canDoFolderAction(accountId, folder, "upload"))) {
        cleanup();
        return { error: { status: 403, message: "Bạn không có quyền upload vào thư mục này" } };
      }
    }

    const savedFiles = await Promise.all(
      files.map((file) =>
        SharedFileModel.create({
          originalName: Buffer.from(file.originalname, "latin1").toString("utf8"),
          filename: file.filename,
          folder_id: folderId || null,
          mimeType: file.mimetype,
          size: file.size,
          uploadedBy: accountId
        })
      )
    );

    return { data: savedFiles };
  },

  // Trả về { error } hoặc { file, filePath }
  async getViewablePath(accountId, fileId) {
    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) return { error: { status: 404, message: "Không tìm thấy file" } };

    if (!(await canDoFileAction(accountId, file, "view"))) {
      return { error: { status: 403, message: "Bạn không có quyền xem file này" } };
    }

    const filePath = getSharedFilePath(file.folder_id, file.filename);
    if (!fs.existsSync(filePath)) {
      return { error: { status: 404, message: "File không tồn tại trên server" } };
    }

    return { file, filePath };
  },

  async convertHeicIfNeeded(file, filePath) {
    const isHeic = ["image/heic", "image/heif"].includes(file.mimeType?.toLowerCase());
    if (!isHeic) return null;

    const inputBuffer = fs.readFileSync(filePath);
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: "JPEG", quality: 0.85 });
    const jpegName = file.originalName.replace(/\.(heic|heif)$/i, ".jpg");
    return { buffer: Buffer.from(outputBuffer), name: jpegName };
  },

  async getDownloadablePath(accountId, fileId) {
    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) return { error: { status: 404, message: "Không tìm thấy file" } };

    if (!(await canDoFileAction(accountId, file, "download"))) {
      return { error: { status: 403, message: "Bạn không có quyền tải file này" } };
    }

    const filePath = getSharedFilePath(file.folder_id, file.filename);
    if (!fs.existsSync(filePath)) {
      return { error: { status: 404, message: "File không tồn tại trên server" } };
    }

    return { file, filePath };
  },

  async deleteFile(accountId, fileId) {
    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) return { error: { status: 404, message: "Không tìm thấy file" } };

    if (!(await canDoFileAction(accountId, file, "delete_file"))) {
      return { error: { status: 403, message: "Bạn không có quyền xóa file này" } };
    }

    file.isDeleted = true;
    file.deletedBy = accountId;
    file.deletedAt = new Date();
    await file.save();

    safeUnlink(getSharedFilePath(file.folder_id, file.filename));

    return { data: true };
  },

  async renameFile(accountId, fileId, name) {
    if (!name?.trim()) return { error: { status: 400, message: "Tên file không được để trống" } };

    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) return { error: { status: 404, message: "Không tìm thấy file" } };

    if (!(await canDoFileAction(accountId, file, "manage"))) {
      return { error: { status: 403, message: "Bạn không có quyền đổi tên file này" } };
    }

    file.originalName = name.trim();
    await file.save();

    return { data: file };
  },

  async moveFile(accountId, fileId, folderId) {
    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) return { error: { status: 404, message: "Không tìm thấy file" } };

    if (folderId) {
      const targetFolder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
      if (!targetFolder) return { error: { status: 404, message: "Thư mục đích không tồn tại" } };
      if (!(await canDoFolderAction(accountId, targetFolder, "upload"))) {
        return {
          error: { status: 403, message: "Bạn không có quyền di chuyển file vào thư mục đích" }
        };
      }
    }

    const oldPath = getSharedFilePath(file.folder_id, file.filename);
    const newFolderId = folderId || null;
    const newPath = getSharedFilePath(newFolderId, file.filename);

    if (oldPath !== newPath) {
      const newDir = path.dirname(newPath);
      fs.mkdirSync(newDir, { recursive: true });

      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      } else {
        return {
          error: {
            status: 404,
            message: "File không tồn tại trên server ở vị trí hiện tại, không thể di chuyển"
          }
        };
      }
    }

    file.folder_id = folderId || null;
    await file.save();

    return { data: file };
  }
};

module.exports = { SharedFileService };

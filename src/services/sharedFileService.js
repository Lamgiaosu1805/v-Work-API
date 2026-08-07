const fs = require("fs");
const heicConvert = require("heic-convert");
const path = require("path");
const SharedFolderModel = require("../models/SharedFolderModel");
const SharedFileModel = require("../models/SharedFileModel");
const { getSharedFilePath } = require("../middlewares/uploadShared");
const { getFullNameMap } = require("../controllers/InternalFileController");
const { canDoFolderAction, canDoFileAction } = require("../helpers/shareFolderHelper");
const { safeUnlink } = require("./sharedFolderService");
const {
  getRootFolderId,
  createAuditLog,
  mappingMessageAuditLog
} = require("../helpers/sharedFolderAuditLogHelper");
const { TARGET_TYPES, AUDIT_ACTION } = require("../models/SharedFolderAuditLogModel");

const SharedFileService = {
  async getFilesByFolder(accountId, folderId, search = "") {
    const hasFolderId = folderId && folderId !== "null";
    const folderFilter = hasFolderId ? { folder_id: folderId } : { folder_id: { $in: [null] } };

    if (hasFolderId) {
      const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
      if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };
      if (!(await canDoFolderAction(accountId, folder, "view"))) {
        return { error: { status: 403, message: "Bạn không có quyền xem thư mục này" } };
      }
    }

    let files = await SharedFileModel.find({
      isDeleted: false,
      ...folderFilter
    })
      .populate("uploadedBy", "username")
      .sort({ createdAt: -1 });

    const keyword = search?.trim();
    if (keyword) {
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      files = files.filter((f) => regex.test(f.originalName.replace(/\.[^./\\]+$/, "")));
    }

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
    const rootFolderId = await getRootFolderId(folderId);
    const cleanup = () => files.forEach((f) => safeUnlink(f.path));

    if (!rootFolderId) {
      cleanup();
      return {
        error: { status: 400, message: "Thư mục gốc không tồn tại. Không thể upload file" }
      };
    }

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

    await savedFiles.map((file) =>
      createAuditLog({
        rootFolderId,
        folderId: file.folder_id,
        targetType: TARGET_TYPES.FILE,
        targetId: file._id,
        action: AUDIT_ACTION.UPLOAD_FILE,
        performedBy: accountId,
        targetName: file.originalName,
        message: mappingMessageAuditLog.UPLOAD_FILE(file.originalName)
      })
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

    // const rootFolderId = await getRootFolderId(file.folder_id);

    // await createAuditLog({
    //   rootFolderId,
    //   folderId: file.folder_id,
    //   targetType: TARGET_TYPES.FILE,
    //   targetId: file._id,
    //   action: AUDIT_ACTION.VIEW_FILE,
    //   performedBy: accountId,
    //   targetName: file.originalName,
    //   message: mappingMessageAuditLog.VIEW_FILE(file.originalName)
    // });

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

    const rootFolderId = await getRootFolderId(file.folder_id);

    await createAuditLog({
      rootFolderId,
      folderId: file.folder_id,
      targetType: TARGET_TYPES.FILE,
      targetId: file._id,
      action: AUDIT_ACTION.DOWNLOAD_FILE,
      performedBy: accountId,
      targetName: file.originalName,
      message: mappingMessageAuditLog.DOWNLOAD_FILE(file.originalName)
    });

    return { file, filePath };
  },

  async deleteFile(accountId, fileIds) {
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return {
        error: {
          status: 400,
          message: "Danh sách file cần xóa không được để trống"
        }
      };
    }

    const success = [];
    const failed = [];

    for (const fileId of fileIds) {
      const file = await SharedFileModel.findOne({
        _id: fileId,
        isDeleted: false
      });

      if (!file) {
        failed.push({
          fileId,
          status: 404,
          message: "Không tìm thấy file"
        });
        continue;
      }

      if (!(await canDoFileAction(accountId, file, "delete_file"))) {
        failed.push({
          fileId,
          status: 403,
          message: "Bạn không có quyền xóa file này"
        });
        continue;
      }

      const rootFolderId = await getRootFolderId(file.folder_id);

      file.isDeleted = true;
      file.deletedBy = accountId;
      file.deletedAt = new Date();

      await file.save();

      safeUnlink(getSharedFilePath(file.folder_id, file.filename));

      await createAuditLog({
        rootFolderId,
        folderId: file.folder_id,
        targetType: TARGET_TYPES.FILE,
        targetId: file._id,
        action: AUDIT_ACTION.DELETE_FILE,
        performedBy: accountId,
        targetName: file.originalName,
        message: mappingMessageAuditLog.DELETE_FILE(file.originalName)
      });

      success.push({
        fileId: file._id,
        originalName: file.originalName
      });
    }

    return {
      data: {
        success,
        failed,
        total: fileIds.length,
        deleted: success.length,
        failedCount: failed.length
      }
    };
  },

  async renameFile(accountId, fileId, name) {
    if (!name?.trim()) return { error: { status: 400, message: "Tên file không được để trống" } };

    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) return { error: { status: 404, message: "Không tìm thấy file" } };

    if (!(await canDoFileAction(accountId, file, "manage"))) {
      return { error: { status: 403, message: "Bạn không có quyền đổi tên file này" } };
    }

    const oldName = file.originalName;
    const newName = name.trim();

    const rootFolderId = await getRootFolderId(file.folder_id);

    file.originalName = name.trim();
    await file.save();

    await createAuditLog({
      rootFolderId,
      folderId: file.folder_id,
      targetType: TARGET_TYPES.FILE,
      targetId: file._id,
      action: AUDIT_ACTION.RENAME_FILE,
      performedBy: accountId,
      targetName: newName,
      message: mappingMessageAuditLog.RENAME_FILE(oldName, newName)
    });

    return { data: file };
  },

  async moveFile(accountId, fileId, folderId) {
    const file = await SharedFileModel.findOne({
      _id: fileId,
      isDeleted: false
    });

    if (!file) {
      return {
        error: {
          status: 404,
          message: "Không tìm thấy file"
        }
      };
    }

    if (folderId) {
      const targetFolder = await SharedFolderModel.findOne({
        _id: folderId,
        isDeleted: false
      });

      if (!targetFolder) {
        return {
          error: {
            status: 404,
            message: "Thư mục đích không tồn tại"
          }
        };
      }

      if (!(await canDoFolderAction(accountId, targetFolder, "manage"))) {
        return {
          error: {
            status: 403,
            message: "Bạn không có quyền di chuyển file vào thư mục đích"
          }
        };
      }
    }

    const oldFolderId = file.folder_id;
    const newFolderId = folderId || null;

    const oldPath = getSharedFilePath(oldFolderId, file.filename);

    const newPath = getSharedFilePath(newFolderId, file.filename);

    if (oldPath !== newPath) {
      const newDir = path.dirname(newPath);
      fs.mkdirSync(newDir, { recursive: true });

      if (!fs.existsSync(oldPath)) {
        return {
          error: {
            status: 404,
            message: "File không tồn tại trên server ở vị trí hiện tại, không thể di chuyển"
          }
        };
      }

      fs.renameSync(oldPath, newPath);
    }

    const rootFolderId = await getRootFolderId(newFolderId || oldFolderId);

    file.folder_id = newFolderId;
    await file.save();

    await createAuditLog({
      rootFolderId,
      folderId: newFolderId,
      targetType: TARGET_TYPES.FILE,
      targetId: file._id,
      action: AUDIT_ACTION.MOVE_FILE,
      performedBy: accountId,
      targetName: file.originalName,
      message: mappingMessageAuditLog.MOVE_FILE(file.originalName, oldPath, newPath)
    });

    return { data: file };
  }
};

module.exports = { SharedFileService };

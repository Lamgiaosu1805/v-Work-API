const { canDoFolderAction } = require("../helpers/shareFolderHelper");
const SharedFileModel = require("../models/SharedFileModel");
const SharedFolderModel = require("../models/SharedFolderModel");

async function canCreateFolder(req, res, next) {
  try {
    const isSuperAdmin = req.account?.username === "admin";
    const { parent_id } = req.body;

    if (!parent_id) {
      if (isSuperAdmin) return next();
      return res.status(403).json({ message: "Chỉ admin mới được tạo thư mục gốc mới" });
    }

    if (isSuperAdmin) return next();

    const parentFolder = await SharedFolderModel.findOne({
      _id: parent_id,
      isDeleted: false
    });
    if (!parentFolder) {
      return res.status(404).json({ message: "Thư mục cha không tồn tại" });
    }

    const allowed = await canDoFolderAction(req.account._id, parentFolder, "manage");
    if (!allowed) {
      return res.status(403).json({ message: "Bạn không có quyền tạo thư mục trong thư mục này" });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
}

async function canManagerFolder(req, res, next) {
  try {
    const isSuperAdmin = req.account?.username === "admin";
    const { rootFolderId } = req.params;

    if (isSuperAdmin) return next();

    const folder = await SharedFolderModel.findOne({
      _id: rootFolderId,
      isDeleted: false
    });
    if (!folder) {
      return res.status(404).json({ message: "Thư mục không tồn tại" });
    }

    const allowed = await canDoFolderAction(req.account._id, folder, "manage");
    if (!allowed) {
      return res.status(403).json({ message: "Bạn không có quyền quản lý thư mục này" });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
}

async function canManageFileFolder(req, res, next) {
  try {
    const isSuperAdmin = req.account?.username === "admin";
    const { fileId } = req.params;

    const file = await SharedFileModel.findOne({ _id: fileId, isDeleted: false });
    if (!file) {
      return res.status(404).json({ message: "Không tìm thấy file" });
    }

    if (isSuperAdmin) {
      req.sharedFile = file;
      return next();
    }

    if (!file.folder_id) {
      return res.status(403).json({ message: "Bạn không có quyền xem lịch sử file này" });
    }

    const folder = await SharedFolderModel.findOne({ _id: file.folder_id, isDeleted: false });
    if (!folder) {
      return res.status(404).json({ message: "Thư mục chứa file không tồn tại" });
    }

    const allowed = await canDoFolderAction(req.account._id, folder, "manage");
    if (!allowed) {
      return res.status(403).json({ message: "Bạn không có quyền xem lịch sử file này" });
    }

    req.sharedFile = file;
    return next();
  } catch (error) {
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
}

module.exports = { canCreateFolder, canManagerFolder, canManageFileFolder };

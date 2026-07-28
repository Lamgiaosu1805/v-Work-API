const { SharedFolderService } = require("../services/sharedFolderService");
const { SharedFileService } = require("../services/sharedFileService");

const SharedFolderController = {
  // GET /shared-folders/folders?parent_id=xxx
  getFolders: async (req, res) => {
    try {
      const { parent_id } = req.query;
      const parentId = parent_id && parent_id !== "null" ? parent_id : null;

      const data = await SharedFolderService.getFolders(req.account._id, parentId);
      return res.status(200).json({ message: "Thành công", data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /shared-folders/folders/all
  getAllFolders: async (req, res) => {
    try {
      const data = await SharedFolderService.getAllFolders();
      return res.status(200).json({ message: "Thành công", data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /shared-folders/folders
  createFolder: async (req, res) => {
    try {
      const result = await SharedFolderService.createFolder(req.account._id, req.body);
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(201).json({ message: "Tạo thư mục thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PATCH /shared-folders/folders/:folderId/rename
  renameFolder: async (req, res) => {
    try {
      const result = await SharedFolderService.renameFolder(
        req.account._id,
        req.params.folderId,
        req.body.name
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Đổi tên thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PATCH /shared-folders/folders/:folderId/move
  moveFolder: async (req, res) => {
    try {
      const result = await SharedFolderService.moveFolder(
        req.account._id,
        req.params.folderId,
        req.body.parent_id
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Di chuyển thư mục thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // DELETE /shared-folders/folders/:folderId
  deleteFolder: async (req, res) => {
    try {
      const result = await SharedFolderService.deleteFolder(req.account._id, req.params.folderId);
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Đã xóa thư mục", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /shared-folders/files?folder_id=xxx
  getFilesByFolder: async (req, res) => {
    try {
      const result = await SharedFileService.getFilesByFolder(req.account._id, req.query.folder_id);
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /shared-folders/upload
  uploadFile: async (req, res) => {
    try {
      const result = await SharedFileService.uploadFiles(
        req.account._id,
        req.body.folder_id,
        req.files
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res
        .status(201)
        .json({ message: `Đã tải lên ${result.data.length} file`, data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /shared-folders/file/:fileId/view
  viewFile: async (req, res) => {
    try {
      const result = await SharedFileService.getViewablePath(req.account._id, req.params.fileId);
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      const { file, filePath } = result;
      const converted = await SharedFileService.convertHeicIfNeeded(file, filePath);
      if (converted) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader(
          "Content-Disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(converted.name)}`
        );
        return res.send(converted.buffer);
      }

      res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`
      );
      return res.sendFile(filePath);
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /shared-folders/file/:fileId/download
  downloadFile: async (req, res) => {
    try {
      const result = await SharedFileService.getDownloadablePath(
        req.account._id,
        req.params.fileId
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.download(result.filePath, result.file.originalName);
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // DELETE /shared-folders/file/:fileId
  deleteFile: async (req, res) => {
    try {
      const result = await SharedFileService.deleteFile(req.account._id, req.params.fileId);
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Xóa file thành công" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PATCH /shared-folders/file/:fileId/rename
  renameFile: async (req, res) => {
    try {
      const result = await SharedFileService.renameFile(
        req.account._id,
        req.params.fileId,
        req.body.name
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Đổi tên thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PATCH /shared-folders/file/:fileId/move
  moveFile: async (req, res) => {
    try {
      const result = await SharedFileService.moveFile(
        req.account._id,
        req.params.fileId,
        req.body.folder_id
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Di chuyển file thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /shared-folders/:folderId/permissions
  getPermissions: async (req, res) => {
    try {
      const result = await SharedFolderService.getPermissions(req.params.folderId);
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PUT /shared-folders/:folderId/permissions
  updatePermissions: async (req, res) => {
    try {
      const result = await SharedFolderService.updatePermissions(
        req.params.folderId,
        req.body.permissions,
        req.body.defaultActions
      );
      if (result.error)
        return res.status(result.error.status).json({ message: result.error.message });

      return res.status(200).json({ message: "Cập nhật quyền thành công", data: result.data });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  }
};

module.exports = { SharedFolderController };

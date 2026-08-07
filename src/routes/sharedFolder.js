const express = require("express");

const router = express.Router();
const { authenticate, isSuperAdmin } = require("../middlewares/authMiddleware");
const { uploadShared, uploadError } = require("../middlewares/uploadShared");
const { SharedFolderController } = require("../controllers/SharedFolderController");
const {
  canManagerFolder,
  canCreateFolder,
  canManageFileFolder
} = require("../middlewares/sharedFolderMiddleware");

// Folder routes
router.get("/folders", authenticate, SharedFolderController.getFolders);
router.get("/folders/all", authenticate, SharedFolderController.getAllFolders);
router.post("/folders", authenticate, canCreateFolder, SharedFolderController.createFolder);

router.patch("/folders/:folderId/rename", authenticate, SharedFolderController.renameFolder);
router.patch("/folders/:folderId/move", authenticate, SharedFolderController.moveFolder);
router.delete("/folders/:folderId", authenticate, SharedFolderController.deleteFolder);

// File routes
router.get("/files", authenticate, SharedFolderController.getFilesByFolder);
router.post(
  "/upload",
  authenticate,
  uploadShared.array("files", 20),
  uploadError,
  SharedFolderController.uploadFile
);
router.get("/file/:fileId/view", authenticate, SharedFolderController.viewFile);
router.get("/file/:fileId/download", authenticate, SharedFolderController.downloadFile);
router.patch("/file/:fileId/rename", authenticate, SharedFolderController.renameFile);
router.patch("/file/:fileId/move", authenticate, SharedFolderController.moveFile);
router.delete("/file", authenticate, SharedFolderController.deleteFile);

router.delete("/delete-multiple", authenticate, SharedFolderController.deleteMultiple);

router.get(
  "/:folderId/permissions",
  authenticate,
  isSuperAdmin,
  SharedFolderController.getPermissions
);
router.put(
  "/:folderId/permissions",
  authenticate,
  isSuperAdmin,
  SharedFolderController.updatePermissions
);

router.patch(
  "/:folderId/default-actions",
  authenticate,
  isSuperAdmin,
  SharedFolderController.updateDefaultActions
);
router.patch(
  "/:folderId/auto-cleanup",
  authenticate,
  isSuperAdmin,
  SharedFolderController.updateAutoCleanup
);

router.get(
  "/:rootFolderId/audit-logs",
  authenticate,
  canManagerFolder,
  SharedFolderController.getAuditLogs
);

router.get(
  "/file/:fileId/audit-logs",
  authenticate,
  canManageFileFolder,
  SharedFolderController.getFileAuditLogs
);

router.delete(
  "/:rootFolderId/audit-logs",
  authenticate,
  isSuperAdmin,
  SharedFolderController.clearAuditLogs
);

module.exports = router;

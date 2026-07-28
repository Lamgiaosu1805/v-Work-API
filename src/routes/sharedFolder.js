const express = require("express");

const router = express.Router();
const { authenticate } = require("../middlewares/authMiddleware");
const { uploadShared } = require("../middlewares/uploadShared");
const { SharedFolderController } = require("../controllers/SharedFolderController");
const { requirePermission } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");

// Folder routes
router.get("/folders", authenticate, SharedFolderController.getFolders);
router.get("/folders/all", authenticate, SharedFolderController.getAllFolders);
router.post(
  "/folders",
  authenticate,
  requirePermission(PERMISSION.FOLDER_SHARED_CREATE),
  SharedFolderController.createFolder
);
router.patch("/folders/:folderId/rename", authenticate, SharedFolderController.renameFolder);
router.patch("/folders/:folderId/move", authenticate, SharedFolderController.moveFolder);
router.delete("/folders/:folderId", authenticate, SharedFolderController.deleteFolder);

// File routes
router.get("/files", authenticate, SharedFolderController.getFilesByFolder);
router.post(
  "/upload",
  authenticate,
  uploadShared.array("files", 20),
  requirePermission(PERMISSION.FOLDER_SHARED_UPLOAD),
  SharedFolderController.uploadFile
);
router.get("/file/:fileId/view", authenticate, SharedFolderController.viewFile);
router.get("/file/:fileId/download", authenticate, SharedFolderController.downloadFile);
router.patch("/file/:fileId/rename", authenticate, SharedFolderController.renameFile);
router.patch("/file/:fileId/move", authenticate, SharedFolderController.moveFile);
router.delete("/file/:fileId", authenticate, SharedFolderController.deleteFile);

router.get(
  "/:folderId/permissions",
  authenticate,
  requirePermission(PERMISSION.FOLDER_SHARED_MANAGE),
  SharedFolderController.getPermissions
);
router.put(
  "/:folderId/permissions",
  authenticate,
  requirePermission(PERMISSION.FOLDER_SHARED_MANAGE),
  SharedFolderController.updatePermissions
);

module.exports = router;

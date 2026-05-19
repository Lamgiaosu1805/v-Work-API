const express = require("express");
const router = express.Router();
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");
const { uploadInternal } = require("../middlewares/uploadInternal");
const { InternalFileController } = require("../controllers/InternalFileController");

router.get("/departments", authenticate, InternalFileController.getAccessibleDepartments);

// Folder routes
router.get("/:deptId/folders", authenticate, InternalFileController.getFolders);
router.post("/:deptId/folders", authenticate, InternalFileController.createFolder);
router.delete("/:deptId/folders/:folderId", authenticate, InternalFileController.deleteFolder);

// File routes
router.get("/:deptId/files", authenticate, InternalFileController.getFilesByDept);
router.post("/:deptId/upload", authenticate, uploadInternal.array("files", 20), InternalFileController.uploadFile);
router.get("/file/:fileId/view", authenticate, InternalFileController.viewFile);
router.delete("/file/:fileId", authenticate, InternalFileController.deleteFile);

// Permission routes (admin only)
router.get("/:deptId/permissions", authenticate, isAdmin, InternalFileController.getPermissions);
router.post("/:deptId/grant", authenticate, isAdmin, InternalFileController.grantAccess);
router.post("/:deptId/revoke", authenticate, isAdmin, InternalFileController.revokeAccess);

module.exports = router;

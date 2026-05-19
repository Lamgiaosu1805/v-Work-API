const express = require("express");
const router = express.Router();
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");
const { uploadInternal } = require("../middlewares/uploadInternal");
const { InternalFileController } = require("../controllers/InternalFileController");

router.get("/departments", authenticate, InternalFileController.getAccessibleDepartments);
router.get("/:deptId/files", authenticate, InternalFileController.getFilesByDept);
router.post("/:deptId/upload", authenticate, uploadInternal.array("files", 10), InternalFileController.uploadFile);
router.get("/file/:fileId/view", authenticate, InternalFileController.viewFile);
router.delete("/file/:fileId", authenticate, InternalFileController.deleteFile);
router.get("/:deptId/permissions", authenticate, isAdmin, InternalFileController.getPermissions);
router.post("/:deptId/grant", authenticate, isAdmin, InternalFileController.grantAccess);
router.post("/:deptId/revoke", authenticate, isAdmin, InternalFileController.revokeAccess);

module.exports = router;

const express = require("express");
const DocumentController = require("../controllers/DocumentController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

const router = express.Router();

// GET
router.get(
  "/getListDocument",
  authenticate,
  requirePermission("document.view", "Document"),
  DocumentController.getListDocument
);
router.get(
  "/getFile",
  authenticate,
  requirePermission("document.view", "Document"),
  DocumentController.getFile
);

// POST
router.post(
  "/createTypeDocument",
  authenticate,
  requirePermission("document_type.manage", "DocumentType"),
  DocumentController.createTypeDocument
);

module.exports = router;

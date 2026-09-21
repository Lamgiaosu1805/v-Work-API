const express = require("express");
const path = require("path");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const LaborContractController = require("../controllers/LaborController");
const upload = require("../middlewares/uploadFile");

const router = express.Router();

function onlyAllowPDF(req, res, next) {
  const { file } = req;
  if (!file) return res.status(400).json({ message: "Cần đính kèm file PDF." });
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== ".pdf")
    return res.status(400).json({ message: "Chỉ được upload file PDF cho hợp đồng." });
  next();
}

// POST
router.post(
  "/createLaborContract",
  authenticate,
  requirePermission("labor_contract.create", "LaborContract"),
  upload.single("file"),
  onlyAllowPDF,
  LaborContractController.createLaborContract
);

module.exports = router;

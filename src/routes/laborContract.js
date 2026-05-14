const express = require('express');
const { authenticate, canManage } = require('../middlewares/authMiddleware');
const LaborContractController = require('../controllers/LaborController');
const router = express.Router();
const path = require('path');
const upload = require('../middlewares/uploadFile');

function onlyAllowPDF(req, res, next) {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Cần đính kèm file PDF.' });
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf') return res.status(400).json({ message: 'Chỉ được upload file PDF cho hợp đồng.' });
  next();
}

// POST
router.post('/createLaborContract', authenticate, canManage("hrm"), upload.single("file"), onlyAllowPDF, LaborContractController.createLaborContract);

module.exports = router;

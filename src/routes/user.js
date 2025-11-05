const express = require("express");
const router = express.Router();
const { isAdmin, authenticate } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/uploadFile");
const UserController = require("../controllers/UserController");
const DocumentTypeModel = require("../models/DocumentTypeModel");

// GET danh sách documentType
router.get("/documentTypes", async (req, res) => {
  try {
    const types = await DocumentTypeModel.find({ isDeleted: false });
    res.json(types);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/getUserInfo", authenticate, UserController.getUserInfo)

// POST create user + upload files dynamic
router.post(
  "/createUser",
  authenticate,
  isAdmin,
  async (req, res, next) => {
    try {
      // Lấy tất cả documentType hiện tại
      const docTypes = await DocumentTypeModel.find({ isDeleted: false });
      const fields = docTypes.map((doc) => ({ name: doc._id.toString(), maxCount: 10 }));

      // Gọi multer.fields dynamic
      upload.fields(fields)(req, res, function (err) {
        if (err) return res.status(400).json({ message: err.message });
        next();
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  UserController.createUser
);

// router.post("/createAdmin", UserController.createAdmin);

module.exports = router;

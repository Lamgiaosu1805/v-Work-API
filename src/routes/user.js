const express = require("express");

const router = express.Router();
const { authenticate, hasModuleAccess, canManage } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/uploadFile");
const uploadDocuments = require("../middlewares/uploadDocuments");
const UserController = require("../controllers/UserController");
const { can } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");

async function canManageEmployees(req, res, next) {
  try {
    if (req.account?.role === "admin") return next();
    if (req.account?.role === "manager" && req.account?.module_access?.includes("hrm"))
      return next();
    if (await can(req.account, PERMISSION.HRM_EMPLOYEE_EDIT)) return next();
    return res
      .status(403)
      .json({ errorCode: "FORBIDDEN", message: "Bạn không có quyền quản lý nhân viên" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi kiểm tra quyền", error: err.message });
  }
}

// GET
router.get("/getUsers", authenticate, UserController.getUsers);
router.get("/getUserInfo", authenticate, UserController.getUserInfo);
router.get("/getQRSale", authenticate, UserController.generateMyQR);
router.get("/getUserById/:id", authenticate, UserController.getUserById);
router.get("/birthday/this-month", authenticate, UserController.getBirthdayThisMonth);
router.get("/profile/:accountId", authenticate, UserController.getProfile);

// PUT
router.put(
  "/updateUser/:id",
  authenticate,
  canManageEmployees,
  uploadDocuments,
  UserController.updateUser
);

// POST
router.post(
  "/createUser",
  authenticate,
  canManageEmployees,
  uploadDocuments,
  UserController.createUser
);
router.post("/uploadAvatar", authenticate, upload.single("avatar"), UserController.uploadAvatar);
router.post(
  "/uploadCoverPhoto",
  authenticate,
  upload.single("cover_photo"),
  UserController.uploadCoverPhoto
);

router.patch(
  "/:id/employment-status",
  authenticate,
  canManageEmployees,
  UserController.setEmploymentStatus
);

module.exports = router;

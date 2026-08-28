const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const upload = require("../middlewares/uploadFile");
const uploadDocuments = require("../middlewares/uploadDocuments");
const UserController = require("../controllers/UserController");

// GET
router.get(
  "/getUsers",
  authenticate,
  requirePermission("employee.view", "Employee"),
  UserController.getUsers
);
router.get("/getUserInfo", authenticate, UserController.getUserInfo);
router.get("/getQRSale", authenticate, UserController.generateMyQR);
router.get(
  "/getUserById/:id",
  authenticate,
  requirePermission("employee.view", "Employee"),
  UserController.getUserById
);
router.get(
  "/birthday/this-month",
  authenticate,
  requirePermission("employee.view", "Employee"),
  UserController.getBirthdayThisMonth
);
router.get(
  "/profile/:accountId",
  authenticate,
  requirePermission("employee.view", "Employee"),
  UserController.getProfile
);

// PUT
router.put(
  "/updateUser/:id",
  authenticate,
  requirePermission("employee.update", "Employee"),
  uploadDocuments,
  UserController.updateUser
);

// POST
router.post(
  "/createUser",
  authenticate,
  requirePermission("employee.create", "Employee"),
  uploadDocuments,
  UserController.createUser
);
router.post("/uploadAvatar", authenticate, upload.single("avatar"), UserController.uploadAvatar);
router.post("/uploadCoverPhoto", authenticate, upload.single("cover_photo"), UserController.uploadCoverPhoto);

router.patch(
  "/:id/employment-status",
  authenticate,
  requirePermission("employee.set_status", "Employee"),
  UserController.setEmploymentStatus
);

module.exports = router;

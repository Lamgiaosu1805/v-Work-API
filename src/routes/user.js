const express = require("express");
const router = express.Router();
const { authenticate, hasModuleAccess, canManage } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/uploadFile");
const uploadDocuments = require("../middlewares/uploadDocuments");
const UserController = require("../controllers/UserController");

// GET
router.get("/getUsers", authenticate, hasModuleAccess("hrm"), UserController.getUsers);
router.get("/getUserInfo", authenticate, UserController.getUserInfo);
router.get("/getQRSale", authenticate, UserController.generateMyQR);
router.get("/getUserById/:id", authenticate, hasModuleAccess("hrm"), UserController.getUserById);
router.get("/birthday/this-month", authenticate, hasModuleAccess("hrm"), UserController.getBirthdayThisMonth);

// PUT
router.put("/updateUser/:id", authenticate, canManage("hrm"), uploadDocuments, UserController.updateUser);

// POST
router.post("/createUser", authenticate, canManage("hrm"), uploadDocuments, UserController.createUser);
router.post("/uploadAvatar", authenticate, upload.single("avatar"), UserController.uploadAvatar);

module.exports = router;

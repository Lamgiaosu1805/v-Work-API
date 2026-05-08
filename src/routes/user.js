const express = require("express");
const router = express.Router();
const { isAdmin, authenticate } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/uploadFile");
const uploadDocuments = require("../middlewares/uploadDocuments");
const UserController = require("../controllers/UserController");

// GET

router.get("/getUsers", authenticate, isAdmin, UserController.getUsers)
router.get("/getUserInfo", authenticate, UserController.getUserInfo)
router.get("/getQRSale", authenticate, UserController.generateMyQR)
router.get("/getUserById/:id", authenticate, isAdmin, UserController.getUserById)
router.get("/birthday/this-month", authenticate, UserController.getBirthdayThisMonth);

// PUT
router.put("/updateUser/:id", authenticate, isAdmin, uploadDocuments, UserController.updateUser);

// POST
router.post("/createUser", authenticate, isAdmin, uploadDocuments, UserController.createUser);
router.post("/uploadAvatar", authenticate, upload.single("avatar"), UserController.uploadAvatar);

// router.post("/createAdmin", UserController.createAdmin);

module.exports = router;

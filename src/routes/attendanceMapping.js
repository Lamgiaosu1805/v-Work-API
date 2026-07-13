const express = require("express");
const router = express.Router();
const AttendanceMappingController = require("../controllers/AttendanceMappingController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

router.get("/", authenticate, isAdmin, AttendanceMappingController.getAll);
router.post("/", authenticate, isAdmin, AttendanceMappingController.create);
router.patch("/:id", authenticate, isAdmin, AttendanceMappingController.update);
router.delete("/:id", authenticate, isAdmin, AttendanceMappingController.remove);

module.exports = router;

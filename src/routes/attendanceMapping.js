const express = require("express");

const router = express.Router();
const AttendanceMappingController = require("../controllers/AttendanceMappingController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

router.get(
  "/",
  authenticate,
  requirePermission("attendance_mapping.view", "AttendanceMapping"),
  AttendanceMappingController.getAll
);
router.post(
  "/",
  authenticate,
  requirePermission("attendance_mapping.manage", "AttendanceMapping"),
  AttendanceMappingController.create
);
router.patch(
  "/:id",
  authenticate,
  requirePermission("attendance_mapping.manage", "AttendanceMapping"),
  AttendanceMappingController.update
);
router.delete(
  "/:id",
  authenticate,
  requirePermission("attendance_mapping.delete", "AttendanceMapping"),
  AttendanceMappingController.remove
);

module.exports = router;

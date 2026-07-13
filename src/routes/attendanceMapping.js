const express = require("express");

const router = express.Router();
const AttendanceMappingController = require("../controllers/AttendanceMappingController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");

router.get(
  "/",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_ATTENDANCE_MAPPING),
  AttendanceMappingController.getAll
);
router.post(
  "/",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_ATTENDANCE_MAPPING),
  AttendanceMappingController.create
);
router.patch(
  "/:id",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_ATTENDANCE_MAPPING),
  AttendanceMappingController.update
);
router.delete(
  "/:id",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_ATTENDANCE_MAPPING),
  AttendanceMappingController.remove
);

module.exports = router;

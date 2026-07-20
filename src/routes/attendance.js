const express = require("express");
const multer = require("multer");
const AttendanceController = require("../controllers/AttendanceController");
const { authenticate, hasModuleAccess } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");

const router = express.Router();
const uploadMemory = multer({ storage: multer.memoryStorage() });

router.get("/getWorkSheet", authenticate, AttendanceController.getWorkSheet);
router.get("/standard-work-units", authenticate, AttendanceController.getStandardWorkUnits);
router.get("/getLichCong", authenticate, AttendanceController.getLichCong);
router.get("/getAllShifts", authenticate, AttendanceController.getAllShifts);
router.get("/stats", authenticate, AttendanceController.getStats);
router.get("/calendar", authenticate, AttendanceController.getCalendar);
router.get(
  "/getAllowedWifiLocations",
  authenticate,
  requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT),
  AttendanceController.getAllowedWifiLocations
);
router.get(
  "/getAllWorkSheets",
  authenticate,
  hasModuleAccess("hrm"),
  AttendanceController.getAllWorkSheets
);
router.get(
  "/payroll-stats-all",
  authenticate,
  hasModuleAccess("hrm"),
  AttendanceController.getPayrollStatsAll
);
router.get(
  "/payroll-stats/:userId",
  authenticate,
  hasModuleAccess("hrm"),
  AttendanceController.getPayrollStats
);
router.get("/my-payroll-stats", authenticate, AttendanceController.getMyPayrollStats);

router.post(
  "/createAllowedWifiLocation",
  authenticate,
  requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT),
  AttendanceController.createAllowedWifiLocation
);
router.post("/checkIn", authenticate, AttendanceController.checkIn);
router.post("/checkOut", authenticate, AttendanceController.checkOut);
router.post(
  "/createShift",
  authenticate,
  requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT),
  AttendanceController.createShift
);
router.post(
  "/import-excel",
  authenticate,
  requirePermission(PERMISSION.HRM_ATTENDANCE_IMPORT),
  uploadMemory.single("file"),
  AttendanceController.importExcel
);

router.patch(
  "/admin/worksheet/:worksheetId",
  authenticate,
  requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT),
  AttendanceController.adminEditWorksheet
);

router.delete(
  "/deleteAllowedWifiLocation/:id",
  authenticate,
  requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT),
  AttendanceController.deleteAllowedWifiLocation
);

module.exports = router;

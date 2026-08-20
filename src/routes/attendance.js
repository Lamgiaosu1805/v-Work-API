const express = require("express");
const multer = require("multer");
const AttendanceController = require("../controllers/AttendanceController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

const router = express.Router();
const uploadMemory = multer({ storage: multer.memoryStorage() });

router.get(
  "/getWorkSheet",
  authenticate,
  requirePermission("attendance.view", "Attendance"),
  AttendanceController.getWorkSheet
);
router.get(
  "/standard-work-units",
  authenticate,
  requirePermission("attendance.view", "Attendance"),
  AttendanceController.getStandardWorkUnits
);
router.get(
  "/getLichCong",
  authenticate,
  requirePermission("attendance.view", "Attendance"),
  AttendanceController.getLichCong
);
router.get(
  "/getAllShifts",
  authenticate,
  requirePermission("shift_config.view", "ShiftConfig"),
  AttendanceController.getAllShifts
);
router.get(
  "/stats",
  authenticate,
  requirePermission("attendance.view", "Attendance"),
  AttendanceController.getStats
);
router.get(
  "/calendar",
  authenticate,
  requirePermission("attendance.view", "Attendance"),
  AttendanceController.getCalendar
);
router.get(
  "/getAllowedWifiLocations",
  authenticate,
  requirePermission("wifi_config.view", "WifiConfig"),
  AttendanceController.getAllowedWifiLocations
);
router.get(
  "/getAllWorkSheets",
  authenticate,
  requirePermission("attendance.view", "Attendance"),
  AttendanceController.getAllWorkSheets
);
router.get(
  "/payroll-stats-all",
  authenticate,
  requirePermission("payroll.view", "Payroll"),
  AttendanceController.getPayrollStatsAll
);
router.get(
  "/payroll-stats/:userId",
  authenticate,
  requirePermission("payroll.view", "Payroll"),
  AttendanceController.getPayrollStats
);
router.get("/my-payroll-stats", authenticate, AttendanceController.getMyPayrollStats);

router.post(
  "/createAllowedWifiLocation",
  authenticate,
  requirePermission("wifi_config.manage", "WifiConfig"),
  AttendanceController.createAllowedWifiLocation
);
router.post("/checkIn", authenticate, AttendanceController.checkIn);
router.post("/checkOut", authenticate, AttendanceController.checkOut);
router.post(
  "/createShift",
  authenticate,
  requirePermission("shift_config.manage", "ShiftConfig"),
  AttendanceController.createShift
);
router.post(
  "/import-excel",
  authenticate,
  requirePermission("attendance.import", "Attendance"),
  uploadMemory.single("file"),
  AttendanceController.importExcel
);

router.patch(
  "/admin/worksheet/:worksheetId",
  authenticate,
  requirePermission("attendance.edit", "Attendance"),
  AttendanceController.adminEditWorksheet
);

router.delete(
  "/deleteAllowedWifiLocation/:id",
  authenticate,
  requirePermission("wifi_config.delete", "WifiConfig"),
  AttendanceController.deleteAllowedWifiLocation
);

module.exports = router;

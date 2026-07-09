const express = require('express');
const multer = require('multer');
const AttendanceController = require('../controllers/AttendanceController');
const { authenticate, isAdmin, hasModuleAccess } = require('../middlewares/authMiddleware');
const { requirePermission } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");
const router = express.Router();
const uploadMemory = multer({ storage: multer.memoryStorage() });


//GET
router.get('/getWorkSheet', authenticate, AttendanceController.getWorkSheet);
router.get('/standard-work-units', authenticate, AttendanceController.getStandardWorkUnits);
router.get('/getLichCong', authenticate, AttendanceController.getLichCong);
router.get('/getAllShifts', authenticate, AttendanceController.getAllShifts);
router.get('/stats', authenticate, AttendanceController.getStats);
router.get('/calendar', authenticate, AttendanceController.getCalendar);
router.get('/getAllowedWifiLocations', authenticate, isAdmin, AttendanceController.getAllowedWifiLocations);
router.get('/getAllWorkSheets', authenticate, hasModuleAccess('hrm'), AttendanceController.getAllWorkSheets);
router.get('/payroll-stats-all', authenticate, hasModuleAccess('hrm'), AttendanceController.getPayrollStatsAll);
router.get('/payroll-stats/:userId', authenticate, hasModuleAccess('hrm'), AttendanceController.getPayrollStats);

//POST
router.post('/createAllowedWifiLocation', authenticate, isAdmin, AttendanceController.createAllowedWifiLocation);
router.post('/checkIn', authenticate, AttendanceController.checkIn);
router.post('/checkOut', authenticate, AttendanceController.checkOut);
router.post('/createShift', authenticate, isAdmin, AttendanceController.createShift);
router.post('/import-excel', authenticate, requirePermission(PERMISSION.HRM_ATTENDANCE_IMPORT), uploadMemory.single('file'), AttendanceController.importExcel);

//PATCH
router.patch('/admin/worksheet/:worksheetId', authenticate, requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT), AttendanceController.adminEditWorksheet);

//DELETE
router.delete('/deleteAllowedWifiLocation/:id', authenticate, isAdmin, AttendanceController.deleteAllowedWifiLocation);

module.exports = router;
const express = require('express');
const AttendanceController = require('../controllers/AttendanceController');
const { authenticate, isAdmin, hasModuleAccess } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET
router.get('/getWorkSheet', authenticate, AttendanceController.getWorkSheet);
router.get('/getLichCong', authenticate, AttendanceController.getLichCong);
router.get('/getAllShifts', authenticate, AttendanceController.getAllShifts);
router.get('/getAllowedWifiLocations', authenticate, isAdmin, AttendanceController.getAllowedWifiLocations);
router.get('/getAllWorkSheets', authenticate, hasModuleAccess('hrm'), AttendanceController.getAllWorkSheets);

//POST
router.post('/createAllowedWifiLocation', authenticate, isAdmin, AttendanceController.createAllowedWifiLocation);
router.post('/checkIn', authenticate, AttendanceController.checkIn);
router.post('/checkOut', authenticate, AttendanceController.checkOut);
router.post('/createShift', authenticate, isAdmin, AttendanceController.createShift);

//PUT
router.put('/updateAllowedWifiLocation/:id', authenticate, isAdmin, AttendanceController.updateAllowedWifiLocation);
router.put('/updateShift/:id', authenticate, isAdmin, AttendanceController.updateShift);

//DELETE
router.delete('/deleteAllowedWifiLocation/:id', authenticate, isAdmin, AttendanceController.deleteAllowedWifiLocation);
router.delete('/deleteShift/:id', authenticate, isAdmin, AttendanceController.deleteShift);

module.exports = router;
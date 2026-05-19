const express = require('express');
const AttendanceController = require('../controllers/AttendanceController');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET
router.get('/getWorkSheet', authenticate, AttendanceController.getWorkSheet);
router.get('/getLichCong', authenticate, AttendanceController.getLichCong);
router.get('/getAllShifts', authenticate, AttendanceController.getAllShifts);
router.get('/getAllowedWifiLocations', authenticate, isAdmin, AttendanceController.getAllowedWifiLocations);

//POST
router.post('/createAllowedWifiLocation', authenticate, isAdmin, AttendanceController.createAllowedWifiLocation);
router.post('/checkIn', authenticate, AttendanceController.checkIn);
router.post('/checkOut', authenticate, AttendanceController.checkOut);
router.post('/createShift', authenticate, isAdmin, AttendanceController.createShift);

//DELETE
router.delete('/deleteAllowedWifiLocation/:id', authenticate, isAdmin, AttendanceController.deleteAllowedWifiLocation);

module.exports = router;
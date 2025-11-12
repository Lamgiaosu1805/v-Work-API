const express = require('express');
const AttendanceController = require('../controllers/AttendanceController');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET
router.get('/getWorkSheetToday', authenticate, AttendanceController.getWorkSheet);


//POST
router.post('/createAllowedWifiLocation', authenticate, isAdmin, AttendanceController.createAllowedWifiLocation);
router.post('/checkIn', authenticate, AttendanceController.checkIn);
router.post('/checkOut', authenticate, AttendanceController.checkOut);
router.post('/createShift', authenticate, isAdmin, AttendanceController.createShift);

module.exports = router;
const express = require('express');
const AttendanceController = require('../controllers/AttendanceController');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET


//POST
router.post('/createAllowedWifiLocation', authenticate, isAdmin, AttendanceController.createAllowedWifiLocation);
router.post('/sendAttendance', authenticate, AttendanceController.attendance);
router.post('/createShift', authenticate, isAdmin, AttendanceController.createShift);

module.exports = router;
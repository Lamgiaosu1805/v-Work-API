const express = require('express');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const DepartmentPositionController = require('../controllers/DepartmentPositionController');
const router = express.Router()


//GET
router.get('/getAll', authenticate, DepartmentPositionController.getAllDepartments);
router.get('/getAllPositions', authenticate, DepartmentPositionController.getAllPositions);

//POST
router.post('/createDepartment', authenticate, isAdmin, DepartmentPositionController.createDepartment);
router.post('/createPosition', authenticate, isAdmin, DepartmentPositionController.createPosition);



module.exports = router;
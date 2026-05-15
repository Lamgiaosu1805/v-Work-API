const express = require('express');
const { authenticate, isAdmin, hasModuleAccess } = require('../middlewares/authMiddleware');
const DepartmentPositionController = require('../controllers/DepartmentPositionController');
const router = express.Router();

// GET
router.get('/getAll', authenticate, hasModuleAccess("hrm"), DepartmentPositionController.getAllDepartments);
router.get('/getAllPositions', authenticate, DepartmentPositionController.getAllPositions);

// POST
router.post('/createDepartment', authenticate, isAdmin, DepartmentPositionController.createDepartment);
router.post('/createPosition', authenticate, isAdmin, DepartmentPositionController.createPosition);

// PUT
router.put('/update/:id',         authenticate, isAdmin, DepartmentPositionController.updateDepartment);
router.put('/updatePosition/:id', authenticate, isAdmin, DepartmentPositionController.updatePosition);

// DELETE
router.delete('/delete/:id',         authenticate, isAdmin, DepartmentPositionController.deleteDepartment);
router.delete('/deletePosition/:id', authenticate, isAdmin, DepartmentPositionController.deletePosition);

module.exports = router;

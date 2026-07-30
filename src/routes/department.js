const express = require('express');
const { authenticate, hasModuleAccess } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../helpers/rbac');
const { PERMISSION } = require('../constants');
const DepartmentPositionController = require('../controllers/DepartmentPositionController');
const router = express.Router();

const canManageDepartment = requirePermission(PERMISSION.HRM_MENU_DEPARTMENT, PERMISSION.HRM_MENU_BRANCH);
const canManagePosition = requirePermission(PERMISSION.HRM_MENU_POSITIONS);

// GET
router.get('/getAll', authenticate, hasModuleAccess("hrm"), DepartmentPositionController.getAllDepartments);
router.get('/getAllPositions', authenticate, DepartmentPositionController.getAllPositions);

// POST
router.post('/createDepartment', authenticate, canManageDepartment, DepartmentPositionController.createDepartment);
router.post('/createPosition', authenticate, canManagePosition, DepartmentPositionController.createPosition);

// PUT
router.put('/update/:id',         authenticate, canManageDepartment, DepartmentPositionController.updateDepartment);
router.put('/updatePosition/:id', authenticate, canManagePosition, DepartmentPositionController.updatePosition);

// DELETE
router.delete('/delete/:id',         authenticate, canManageDepartment, DepartmentPositionController.deleteDepartment);
router.delete('/deletePosition/:id', authenticate, canManagePosition, DepartmentPositionController.deletePosition);

module.exports = router;

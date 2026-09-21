const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const DepartmentPositionController = require("../controllers/DepartmentPositionController");

const router = express.Router();

// GET
router.get(
  "/getAll",
  authenticate,
  requirePermission("department.view", "Department"),
  DepartmentPositionController.getAllDepartments
);
router.get(
  "/getAllPositions",
  authenticate,
  requirePermission("position.view", "Position"),
  DepartmentPositionController.getAllPositions
);

// POST
router.post(
  "/createDepartment",
  authenticate,
  requirePermission("department.manage", "Department"),
  DepartmentPositionController.createDepartment
);
router.post(
  "/createPosition",
  authenticate,
  requirePermission("position.manage", "Position"),
  DepartmentPositionController.createPosition
);

// PUT
router.put(
  "/update/:id",
  authenticate,
  requirePermission("department.manage", "Department"),
  DepartmentPositionController.updateDepartment
);
router.put(
  "/updatePosition/:id",
  authenticate,
  requirePermission("position.manage", "Position"),
  DepartmentPositionController.updatePosition
);

// DELETE
router.delete(
  "/delete/:id",
  authenticate,
  requirePermission("department.delete", "Department"),
  DepartmentPositionController.deleteDepartment
);
router.delete(
  "/deletePosition/:id",
  authenticate,
  requirePermission("position.delete", "Position"),
  DepartmentPositionController.deletePosition
);

module.exports = router;

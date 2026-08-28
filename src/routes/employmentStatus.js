const express = require("express");

const router = express.Router();
const EmploymentStatusController = require("../controllers/EmploymentStatusController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

router.get(
  "/",
  authenticate,
  requirePermission("employment_status.view", "EmploymentStatus"),
  EmploymentStatusController.list
);
router.post(
  "/",
  authenticate,
  requirePermission("employment_status.manage", "EmploymentStatus"),
  EmploymentStatusController.create
);
router.patch(
  "/:id",
  authenticate,
  requirePermission("employment_status.manage", "EmploymentStatus"),
  EmploymentStatusController.update
);
router.delete(
  "/:id",
  authenticate,
  requirePermission("employment_status.delete", "EmploymentStatus"),
  EmploymentStatusController.remove
);

module.exports = router;

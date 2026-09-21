const express = require("express");

const router = express.Router();
const BranchController = require("../controllers/BranchController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

router.get(
  "/getAll",
  authenticate,
  requirePermission("branch.view", "Branch"),
  BranchController.getAll
);

router.post(
  "/create",
  authenticate,
  requirePermission("branch.manage", "Branch"),
  BranchController.create
);

router.put(
  "/update/:id",
  authenticate,
  requirePermission("branch.manage", "Branch"),
  BranchController.update
);

router.delete(
  "/delete/:id",
  authenticate,
  requirePermission("branch.delete", "Branch"),
  BranchController.remove
);

module.exports = router;

import express from "express";
import { authenticate, isAdmin } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { permissionHttpController } from "./permission.http.controller";

const router = express.Router();

router.get("/me", authenticate, asyncHandler(permissionHttpController.getMyEffectivePermissions));

router.use(authenticate, isAdmin);

router.get("/roles", asyncHandler(permissionHttpController.listRoles));
router.get(
  "/roles/:id/deletion-impact",
  asyncHandler(permissionHttpController.getRoleDeletionImpact)
);
router.get("/roles/:id", asyncHandler(permissionHttpController.getRoleById));
router.post("/roles", asyncHandler(permissionHttpController.createRole));
router.patch("/roles/:id", asyncHandler(permissionHttpController.updateRole));
router.delete("/roles/:id", asyncHandler(permissionHttpController.deleteRole));

router.get("/employees", asyncHandler(permissionHttpController.listEmployeesForPermission));
router.get(
  "/employees/:employeeId",
  asyncHandler(permissionHttpController.getEmployeePermissionProfile)
);
router.put(
  "/employees/:employeeId",
  asyncHandler(permissionHttpController.updateEmployeePermission)
);

router.get("/data-scope-policies", asyncHandler(permissionHttpController.listDataScopePolicies));
router.get(
  "/data-scope-policies/:id",
  asyncHandler(permissionHttpController.getDataScopePolicyById)
);
router.post("/data-scope-policies", asyncHandler(permissionHttpController.createDataScopePolicy));
router.patch(
  "/data-scope-policies/:id",
  asyncHandler(permissionHttpController.updateDataScopePolicy)
);
router.delete(
  "/data-scope-policies/:id",
  asyncHandler(permissionHttpController.deleteDataScopePolicy)
);

router.get("/field-scope-policies", asyncHandler(permissionHttpController.listFieldScopePolicies));
router.get(
  "/field-scope-policies/:id",
  asyncHandler(permissionHttpController.getFieldScopePolicyById)
);
router.post("/field-scope-policies", asyncHandler(permissionHttpController.createFieldScopePolicy));
router.patch(
  "/field-scope-policies/:id",
  asyncHandler(permissionHttpController.updateFieldScopePolicy)
);
router.delete(
  "/field-scope-policies/:id",
  asyncHandler(permissionHttpController.deleteFieldScopePolicy)
);

router.get("/attribute-catalog", asyncHandler(permissionHttpController.getAttributeCatalog));
router.get("/catalog", asyncHandler(permissionHttpController.listPermissionCatalog));
router.patch(
  "/catalog/:code",
  asyncHandler(permissionHttpController.updatePermissionCatalogWhitelists)
);

export = router;

const RbacController = require("../controllers/RbacController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");
const { createRouter } = require("../middlewares/validateObjectId");

const router = createRouter();

// Toàn bộ API quản trị RBAC chỉ dành cho admin
router.use(authenticate, isAdmin);

router.get("/permissions", RbacController.listPermissions);
router.get("/roles", RbacController.listRoles);
router.get("/users/:accountId", RbacController.getUserAccess);

router.post("/users/:accountId/roles", RbacController.assignRole);
router.delete("/users/:accountId/roles/:roleCode", RbacController.revokeRole);

router.put("/users/:accountId/permissions", RbacController.setUserPermission);
router.delete("/users/:accountId/permissions/:permissionCode", RbacController.removeUserPermission);

module.exports = router;

const KpiAssignmentController = require("../controllers/KpiAssignmentController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView   = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canManage = requirePermission(PERMISSION.KPI_ASSIGNMENT_MANAGE);

router.get("/",    canView,   KpiAssignmentController.list);
router.get("/:id", canView,   KpiAssignmentController.getById);

router.post("/",              canManage, KpiAssignmentController.create);
router.patch("/:id",          canManage, KpiAssignmentController.update);
router.post("/:id/activate",  canManage, KpiAssignmentController.activate);
router.delete("/:id",         canManage, KpiAssignmentController.remove);

module.exports = router;

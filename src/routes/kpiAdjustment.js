const KpiAdjustmentController = require("../controllers/KpiAdjustmentController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView   = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canManage = requirePermission(PERMISSION.KPI_MONTHEND_CLOSE);

router.get("/",       canView,   KpiAdjustmentController.list);
router.get("/:id",    canView,   KpiAdjustmentController.getById);
router.post("/",      canManage, KpiAdjustmentController.create);
router.delete("/:id", canManage, KpiAdjustmentController.remove);

module.exports = router;

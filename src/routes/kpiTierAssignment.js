const KpiTierAssignmentController = require("../controllers/KpiTierAssignmentController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView   = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canManage = requirePermission(PERMISSION.KPI_TIER_CONFIG);

router.get("/",       canView,   KpiTierAssignmentController.list);
router.get("/:id",    canView,   KpiTierAssignmentController.getById);
router.post("/",      canManage, KpiTierAssignmentController.assign);
router.delete("/:id", canManage, KpiTierAssignmentController.remove);

module.exports = router;

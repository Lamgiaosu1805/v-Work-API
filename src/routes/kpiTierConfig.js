const KpiTierConfigController = require("../controllers/KpiTierConfigController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView   = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canManage = requirePermission(PERMISSION.KPI_TIER_CONFIG);

router.get("/",       canView,   KpiTierConfigController.list);
router.get("/:id",    canView,   KpiTierConfigController.getById);
router.post("/",      canManage, KpiTierConfigController.create);
router.patch("/:id",  canManage, KpiTierConfigController.update);
router.delete("/:id", canManage, KpiTierConfigController.remove);

module.exports = router;

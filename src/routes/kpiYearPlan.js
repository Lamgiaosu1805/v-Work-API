const KpiYearPlanController = require("../controllers/KpiYearPlanController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView   = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canManage = requirePermission(PERMISSION.KPI_YEAR_PLAN_ALLOCATE);

router.get("/",                      canView,   KpiYearPlanController.list);
router.get("/:id",                   canView,   KpiYearPlanController.getById);

router.post("/",                     canManage, KpiYearPlanController.create);
router.patch("/:id",                 canManage, KpiYearPlanController.update);
router.post("/:id/activate",         canManage, KpiYearPlanController.activate);
router.patch("/:id/monthly",         canManage, KpiYearPlanController.adjustMonthly);
router.delete("/:id",                canManage, KpiYearPlanController.remove);

module.exports = router;

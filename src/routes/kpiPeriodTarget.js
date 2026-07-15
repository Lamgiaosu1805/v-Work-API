const KpiPeriodTargetController = require("../controllers/KpiPeriodTargetController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView  = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canClose = requirePermission(PERMISSION.KPI_MONTHEND_CLOSE);

router.get("/",             canView,  KpiPeriodTargetController.list);
router.get("/:id",          canView,  KpiPeriodTargetController.getById);
router.post("/sync",        canClose, KpiPeriodTargetController.sync);
router.post("/rollover",    canClose, KpiPeriodTargetController.rollover);
router.post("/:id/close",   canClose, KpiPeriodTargetController.close);

module.exports = router;

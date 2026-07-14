const KpiDailyReportController = require("../controllers/KpiDailyReportController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView   = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);
const canSubmit = requirePermission(PERMISSION.KPI_REPORT_SUBMIT);

router.get("/",            canView,   KpiDailyReportController.list);
router.get("/:id",         canView,   KpiDailyReportController.getById);

router.post("/",           canSubmit, KpiDailyReportController.create);
router.patch("/:id",       canSubmit, KpiDailyReportController.update);
router.post("/:id/submit", canSubmit, KpiDailyReportController.submit);
router.delete("/:id",      canSubmit, KpiDailyReportController.remove);

module.exports = router;

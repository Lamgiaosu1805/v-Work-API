const KpiDashboardController = require("../controllers/KpiDashboardController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

const canView = requirePermission(PERMISSION.KPI_DASHBOARD_VIEW);

router.get("/me", canView, KpiDashboardController.me);
router.get("/team", canView, KpiDashboardController.team);

module.exports = router;

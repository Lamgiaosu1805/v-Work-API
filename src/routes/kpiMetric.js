const KpiMetricController = require("../controllers/KpiMetricController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { createRouter } = require("../middlewares/validateObjectId");
const { PERMISSION } = require("../constants");

const router = createRouter();

router.use(authenticate);

router.get("/", KpiMetricController.list);
router.get("/:id", KpiMetricController.getById);

const canManage = requirePermission(PERMISSION.KPI_METRIC_MANAGE);
router.post("/", canManage, KpiMetricController.create);
router.patch("/:id", canManage, KpiMetricController.update);
router.delete("/:id", canManage, KpiMetricController.remove);

module.exports = router;

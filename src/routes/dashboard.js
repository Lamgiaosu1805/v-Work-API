const express = require("express");
const DashboardController = require("../controllers/DashboardController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

const router = express.Router();

router.use(authenticate, requirePermission("dashboard_metric.view", "DashboardMetric"));
router.get("/key-metrics", DashboardController.getKeyMetrics);
router.get("/funnel", DashboardController.getFunnel);
router.get("/funnel/:stage/customers", DashboardController.getFunnelCustomers);
router.get("/aum-quality", DashboardController.getAumQuality);
router.get("/interaction-kpi", DashboardController.getInteractionKpi);

module.exports = router;

const express = require("express");
const DashboardController = require("../controllers/DashboardController");
const { authenticate, canManage } = require("../middlewares/authMiddleware");

const router = express.Router();

router.use(authenticate, canManage("crm"));
router.get("/key-metrics", DashboardController.getKeyMetrics);
router.get("/funnel", DashboardController.getFunnel);
router.get("/funnel/:stage/customers", DashboardController.getFunnelCustomers);
router.get("/aum-quality", DashboardController.getAumQuality);
router.get("/interaction-kpi", DashboardController.getInteractionKpi);

module.exports = router;

const PERMISSION = Object.freeze({
  KPI_DASHBOARD_VIEW: "kpi.dashboard.view",
  KPI_METRIC_MANAGE: "kpi.metric.manage",
  KPI_YEAR_PLAN_ASSIGN: "kpi.year_plan.assign",
  KPI_YEAR_PLAN_ALLOCATE: "kpi.year_plan.allocate",
  KPI_ASSIGNMENT_MANAGE: "kpi.assignment.manage",
  KPI_TIER_CONFIG: "kpi.tier.config",
  KPI_REPORT_SUBMIT: "kpi.report.submit",
  KPI_MONTHEND_CLOSE: "kpi.monthend.close",
  HRM_REQUEST_VIEW_ALL: "hrm.request.view_all",
  HRM_REQUEST_REVIEW_ALL: "hrm.request.review_all"
});

const PERMISSION_VALUES = Object.values(PERMISSION);

module.exports = { PERMISSION, PERMISSION_VALUES };

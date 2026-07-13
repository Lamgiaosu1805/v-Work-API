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
  HRM_REQUEST_REVIEW_ALL: "hrm.request.review_all",
  HRM_REQUEST_REVIEW: "hrm.request.review",
  HRM_ATTENDANCE_IMPORT: "hrm.attendance.import",
  HRM_ATTENDANCE_EDIT: "hrm.attendance.edit",
  HRM_MENU_ATTENDANCE_SETTINGS: "hrm.menu.attendance_settings",
  HRM_MENU_ATTENDANCE_OVERVIEW: "hrm.menu.attendance_overview",
  HRM_MENU_DEPARTMENT: "hrm.menu.department",
  HRM_MENU_BRANCH: "hrm.menu.branch",
  HRM_MENU_PAYROLL: "hrm.menu.payroll",
  HRM_MENU_WORK_UNIT: "hrm.menu.work_unit",
  HRM_MENU_REPORTS: "hrm.menu.reports",
  HRM_MENU_EVENTS: "hrm.menu.events",
  HRM_MENU_SETTINGS: "hrm.menu.settings",
  HRM_MENU_DOCUMENTS: "hrm.menu.documents",
  HRM_MENU_POSITIONS: "hrm.menu.positions",
  HRM_MENU_LOGS: "hrm.menu.logs",
  HRM_MENU_HELP: "hrm.menu.help",
  HRM_MENU_ATTENDANCE_MAPPING: "hrm.menu.attendance_mapping",
  HRM_MENU_PERMISSIONS: "hrm.menu.permissions",
  HRM_MENU_PERMISSIONS_RBAC: "hrm.menu.permissions_rbac"
});

const PERMISSION_VALUES = Object.values(PERMISSION);

module.exports = { PERMISSION, PERMISSION_VALUES };

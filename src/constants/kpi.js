const KPI_GROUP = Object.freeze({
  OUTPUT: "output",
  INPUT: "input"
});

const KPI_SOURCE = Object.freeze({
  AUTO: "auto",
  MANUAL: "manual"
});

const KPI_AUTO_SOURCE = Object.freeze({
  INVESTMENT_REVENUE: "investment_revenue",
  FLUCTUATION_NET: "fluctuation_net",
  CIF: "cif",
  EKYC: "ekyc",
  ACTIVE_INVESTOR: "active_investor"
});

const KPI_ASSIGNMENT_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  SUPERSEDED: "superseded"
});

const KPI_YEAR_PLAN_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  SUPERSEDED: "superseded"
});

const KPI_PERIOD_TYPE = Object.freeze({
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  QUARTER: "quarter",
  YEAR: "year"
});

const KPI_SCOPE_TYPE = Object.freeze({
  TTKD: "ttkd",
  SALE: "sale"
});

const KPI_DAILY_REPORT_STATUS = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted"
});

const KPI_ADJUSTMENT_REASON = Object.freeze({
  EARLY_TERMINATED: "early_terminated",
  CANCELLED: "cancelled"
});

const KPI_GROUP_VALUES = Object.values(KPI_GROUP);
const KPI_SOURCE_VALUES = Object.values(KPI_SOURCE);
const KPI_AUTO_SOURCE_VALUES = Object.values(KPI_AUTO_SOURCE);
const KPI_ASSIGNMENT_STATUS_VALUES = Object.values(KPI_ASSIGNMENT_STATUS);
const KPI_YEAR_PLAN_STATUS_VALUES = Object.values(KPI_YEAR_PLAN_STATUS);
const KPI_PERIOD_TYPE_VALUES = Object.values(KPI_PERIOD_TYPE);
const KPI_SCOPE_TYPE_VALUES = Object.values(KPI_SCOPE_TYPE);
const KPI_DAILY_REPORT_STATUS_VALUES = Object.values(KPI_DAILY_REPORT_STATUS);
const KPI_ADJUSTMENT_REASON_VALUES = Object.values(KPI_ADJUSTMENT_REASON);

module.exports = {
  KPI_GROUP,
  KPI_SOURCE,
  KPI_AUTO_SOURCE,
  KPI_ASSIGNMENT_STATUS,
  KPI_YEAR_PLAN_STATUS,
  KPI_PERIOD_TYPE,
  KPI_SCOPE_TYPE,
  KPI_DAILY_REPORT_STATUS,
  KPI_ADJUSTMENT_REASON,
  KPI_GROUP_VALUES,
  KPI_SOURCE_VALUES,
  KPI_AUTO_SOURCE_VALUES,
  KPI_ASSIGNMENT_STATUS_VALUES,
  KPI_YEAR_PLAN_STATUS_VALUES,
  KPI_PERIOD_TYPE_VALUES,
  KPI_SCOPE_TYPE_VALUES,
  KPI_DAILY_REPORT_STATUS_VALUES,
  KPI_ADJUSTMENT_REASON_VALUES
};

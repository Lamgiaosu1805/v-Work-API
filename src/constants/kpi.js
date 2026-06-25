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

const KPI_GROUP_VALUES = Object.values(KPI_GROUP);
const KPI_SOURCE_VALUES = Object.values(KPI_SOURCE);
const KPI_AUTO_SOURCE_VALUES = Object.values(KPI_AUTO_SOURCE);

module.exports = {
  KPI_GROUP,
  KPI_SOURCE,
  KPI_AUTO_SOURCE,
  KPI_GROUP_VALUES,
  KPI_SOURCE_VALUES,
  KPI_AUTO_SOURCE_VALUES
};

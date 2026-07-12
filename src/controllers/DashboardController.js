const CustomerModel = require("../models/CustomerModel");
const InvestmentModel = require("../models/InvestmentModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const SaleKpiModel = require("../models/SaleKpiModel");
const AgentModel = require("../models/AgentModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");

const FUNNEL_STAGES = [
  { key: "cif", label: "CIF", description: "Tổng số hồ sơ khách hàng" },
  { key: "not_kyc", label: "Chưa eKYC", description: "Đã tạo CIF nhưng chưa xác thực danh tính" },
  { key: "kyc_verified", label: "Đã eKYC", description: "Đã xác thực danh tính thành công" },
  {
    key: "active_investor",
    label: "Đang đầu tư",
    description: "Có ít nhất một hợp đồng đang hoạt động"
  },
  {
    key: "settled",
    label: "Đã tất toán",
    description: "Đã rút hết vốn và không còn hợp đồng hoạt động"
  },
  { key: "upsale", label: "Up-sale", description: "Có từ hai khoản đầu tư trở lên" },
  { key: "cross_sale", label: "Cross-sale", description: "Đầu tư từ hai sản phẩm khác nhau" },
  {
    key: "agent",
    label: "CTV/Đại lý",
    description: "Khách hàng đồng thời là cộng tác viên hoặc đại lý"
  }
];

const KPI_SEGMENTS = [
  { key: "not_kyc", label: "Chưa eKYC", target: 5000 },
  { key: "kyc_verified", label: "Đã eKYC", target: 4500 },
  { key: "active_investor", label: "Đang đầu tư", target: 3500 },
  { key: "settled", label: "Đã tất toán", target: 2500 },
  { key: "upsale", label: "Up-sale", target: 1800 },
  { key: "cross_sale", label: "Cross-sale", target: 1200 }
];

const parseDateRange = (query) => {
  const from = query.from_date ? new Date(query.from_date) : null;
  let to = null;
  if (query.to_date) to = new Date(query.to_date);
  else if (query.from_date) to = new Date();

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    const error = new Error("Khoảng thời gian không hợp lệ");
    error.status = 400;
    throw error;
  }
  if (from && to && from > to) {
    const error = new Error("Ngày bắt đầu không được lớn hơn ngày kết thúc");
    error.status = 400;
    throw error;
  }

  return { from, to };
};

const dateMatch = (field, range) => {
  if (!range.from && !range.to) return {};
  return {
    [field]: {
      ...(range.from ? { $gte: range.from } : {}),
      ...(range.to ? { $lte: range.to } : {})
    }
  };
};

const previousRange = (range) => {
  if (!range.from || !range.to) return null;
  const duration = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - duration - 1),
    to: new Date(range.from.getTime() - 1)
  };
};

const metricTrend = (current, previous) => {
  if (previous === null || previous === undefined) return { percent: null, label: "N/A" };
  if (previous === 0) return { percent: null, label: current > 0 ? "Mới" : "N/A" };
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  return { percent, label: `${percent >= 0 ? "+" : ""}${percent}%` };
};

const resolveScopedCustomerIds = async (account) => {
  if (account.role === "admin" || account.dept_scope === "all") return null;
  const manager = await UserInfoModel.findOne({
    id_account: account._id,
    isDeleted: false
  })
    .select("_id")
    .lean();
  if (!manager) return [];
  const departmentIds = await UserDepartmentPositionModel.distinct("department", {
    user: manager._id,
    isDeleted: false
  });
  const saleIds = await UserDepartmentPositionModel.distinct("user", {
    department: { $in: departmentIds },
    isDeleted: false
  });
  return CustomerModel.distinct("_id", {
    referred_by: { $in: saleIds },
    isDeleted: false
  });
};

const scopedMatch = (field, customerIds) =>
  customerIds === null ? {} : { [field]: { $in: customerIds } };

const calculateKeyMetrics = async (range, customerIds) => {
  const investmentFilter = {
    isDeleted: false,
    status: "active",
    ...scopedMatch("customer_id", customerIds),
    ...dateMatch("invested_at", range)
  };
  const [kycVerified, activeCustomerIds, aumRows] = await Promise.all([
    CustomerModel.countDocuments({
      isDeleted: false,
      ...scopedMatch("_id", customerIds),
      "identity.verified_at": {
        $ne: null,
        ...(range.from ? { $gte: range.from } : {}),
        ...(range.to ? { $lte: range.to } : {})
      }
    }),
    InvestmentModel.distinct("customer_id", investmentFilter),
    InvestmentModel.aggregate([
      { $match: investmentFilter },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ])
  ]);

  return {
    kyc_verified: kycVerified,
    active_investors: activeCustomerIds.length,
    aum: aumRows[0]?.total || 0
  };
};

const buildFunnelSnapshot = async (range, customerIds) => {
  const baseCustomers = await CustomerModel.find({
    isDeleted: false,
    ...scopedMatch("_id", customerIds),
    ...dateMatch("createdAt", range)
  })
    .select("_id status identity.verified_at agent_id phone_number")
    .lean();
  const baseIds = baseCustomers.map((customer) => customer._id);
  const idStrings = new Set(baseIds.map(String));

  if (!baseIds.length) {
    return Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage.key, []]));
  }

  const investments = await InvestmentModel.find({
    customer_id: { $in: baseIds },
    isDeleted: false,
    ...dateMatch("invested_at", range)
  })
    .select("customer_id product_name status invested_at")
    .sort({ invested_at: 1 })
    .lean();
  // Khoảng lọc chỉ quyết định các hợp đồng phát sinh trong kỳ. Riêng điều kiện
  // "đã tất toán" phải nhìn toàn bộ hợp đồng active để không đánh dấu nhầm
  // khách vẫn còn vốn đang đầu tư từ một kỳ trước.
  const activeCustomerIds = await InvestmentModel.distinct("customer_id", {
    customer_id: { $in: baseIds },
    isDeleted: false,
    status: "active"
  });
  const activeCustomerIdSet = new Set(activeCustomerIds.map(String));
  const agentPhones = await AgentModel.distinct("phone_number", {
    isDeleted: false,
    is_active: true,
    phone_number: { $in: baseCustomers.map((customer) => customer.phone_number).filter(Boolean) }
  });
  const agentPhoneSet = new Set(agentPhones.map(String));

  const investmentByCustomer = new Map();
  investments.forEach((investment) => {
    const key = String(investment.customer_id);
    if (!investmentByCustomer.has(key)) investmentByCustomer.set(key, []);
    investmentByCustomer.get(key).push(investment);
  });

  const snapshot = {
    cif: [...baseIds],
    not_kyc: [],
    kyc_verified: [],
    active_investor: [],
    settled: [],
    upsale: [],
    cross_sale: [],
    agent: []
  };

  baseCustomers.forEach((customer) => {
    const key = String(customer._id);
    const customerInvestments = investmentByCustomer.get(key) || [];
    const statuses = new Set(customerInvestments.map((item) => item.status));
    const products = new Set(customerInvestments.map((item) => item.product_name).filter(Boolean));

    if (customer.status === "registered") snapshot.not_kyc.push(customer._id);
    if (customer.status === "kyc_verified") snapshot.kyc_verified.push(customer._id);
    if (statuses.has("active")) snapshot.active_investor.push(customer._id);
    if (
      customerInvestments.length &&
      !activeCustomerIdSet.has(key) &&
      customerInvestments.every((item) => ["matured", "early_terminated"].includes(item.status))
    ) {
      snapshot.settled.push(customer._id);
    }
    if (customerInvestments.length > products.size) snapshot.upsale.push(customer._id);
    if (products.size >= 2) snapshot.cross_sale.push(customer._id);
    if (customer.agent_id || agentPhoneSet.has(String(customer.phone_number)))
      snapshot.agent.push(customer._id);
  });

  snapshot.agent = snapshot.agent.filter((id) => idStrings.has(String(id)));
  return snapshot;
};

const getCustomerSegment = (customer, investments) => {
  const products = new Set(investments.map((item) => item.product_name).filter(Boolean));
  if (products.size >= 2) return "cross_sale";
  if (investments.length > products.size) return "upsale";
  if (investments.some((item) => item.status === "active")) return "active_investor";
  if (
    investments.length &&
    investments.every((item) => ["matured", "early_terminated"].includes(item.status))
  )
    return "settled";
  if (customer?.identity?.verified_at) return "kyc_verified";
  return "not_kyc";
};

const handleError = (res, error, scope) => {
  console.error(`${scope}:`, error);
  return res.status(error.status || 500).json({
    message: error.status ? error.message : "Không thể tải dữ liệu Dashboard CRM",
    ...(error.status ? {} : { error: error.message })
  });
};

const DashboardController = {
  getKeyMetrics: async (req, res) => {
    try {
      const range = parseDateRange(req.query);
      const priorRange = previousRange(range);
      const customerIds = await resolveScopedCustomerIds(req.account);
      const [current, previous, filteredCustomers, totalCustomers] = await Promise.all([
        calculateKeyMetrics(range, customerIds),
        priorRange ? calculateKeyMetrics(priorRange, customerIds) : Promise.resolve(null),
        CustomerModel.countDocuments({
          isDeleted: false,
          ...scopedMatch("_id", customerIds),
          ...dateMatch("createdAt", range)
        }),
        CustomerModel.countDocuments({
          isDeleted: false,
          ...scopedMatch("_id", customerIds)
        })
      ]);

      return res.status(200).json({
        data: {
          metrics: {
            kyc_verified: {
              value: current.kyc_verified,
              trend: metricTrend(current.kyc_verified, previous?.kyc_verified)
            },
            active_investors: {
              value: current.active_investors,
              trend: metricTrend(current.active_investors, previous?.active_investors)
            },
            aum: { value: current.aum, trend: metricTrend(current.aum, previous?.aum) }
          },
          filtered_customers: filteredCustomers,
          total_customers: totalCustomers
        }
      });
    } catch (error) {
      return handleError(res, error, "getKeyMetrics");
    }
  },

  getFunnel: async (req, res) => {
    try {
      const customerIds = await resolveScopedCustomerIds(req.account);
      const snapshot = await buildFunnelSnapshot(parseDateRange(req.query), customerIds);
      const base = snapshot.cif.length;
      const stages = FUNNEL_STAGES.map((stage, index) => ({
        key: stage.key,
        code: `Q${index + 1}`,
        label: stage.label,
        description: stage.description,
        count: snapshot[stage.key].length,
        percentage: base ? Math.round((snapshot[stage.key].length / base) * 100) : 0
      }));
      return res.status(200).json({ data: { stages, total: base } });
    } catch (error) {
      return handleError(res, error, "getFunnel");
    }
  },

  getFunnelCustomers: async (req, res) => {
    try {
      const { stage } = req.params;
      if (!FUNNEL_STAGES.some((item) => item.key === stage)) {
        return res.status(400).json({ message: "Chặng phễu không hợp lệ" });
      }
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const customerIds = await resolveScopedCustomerIds(req.account);
      const snapshot = await buildFunnelSnapshot(parseDateRange(req.query), customerIds);
      const ids = snapshot[stage];
      const customers = await CustomerModel.find({ _id: { $in: ids }, isDeleted: false })
        .populate("referred_by", "full_name ma_nv phone_number")
        .select("phone_number external_id identity status source_type referred_by createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return res.status(200).json({
        data: customers,
        pagination: { total: ids.length, page, limit, total_pages: Math.ceil(ids.length / limit) }
      });
    } catch (error) {
      return handleError(res, error, "getFunnelCustomers");
    }
  },

  getAumQuality: async (req, res) => {
    try {
      const range = parseDateRange(req.query);
      const customerIdsInScope = await resolveScopedCustomerIds(req.account);
      const qualifying = await InvestmentModel.find({
        isDeleted: false,
        status: { $in: ["active", "matured"] },
        ...scopedMatch("customer_id", customerIdsInScope),
        ...dateMatch("invested_at", range)
      })
        .select("customer_id product_name amount invested_at")
        .sort({ invested_at: 1 })
        .lean();
      const customerIds = [...new Set(qualifying.map((item) => String(item.customer_id)))];
      const history = await InvestmentModel.find({
        customer_id: { $in: customerIds },
        isDeleted: false,
        status: { $ne: "cancelled" }
      })
        .select("customer_id product_name invested_at")
        .sort({ invested_at: 1 })
        .lean();
      const historyByCustomer = new Map();
      history.forEach((item) => {
        const key = String(item.customer_id);
        if (!historyByCustomer.has(key)) historyByCustomer.set(key, []);
        historyByCustomer.get(key).push(item);
      });

      const totals = { new_sales: 0, upsale: 0, cross_sale: 0 };
      qualifying.forEach((item) => {
        const customerHistory = historyByCustomer.get(String(item.customer_id)) || [];
        const index = customerHistory.findIndex(
          (historyItem) => String(historyItem._id) === String(item._id)
        );
        if (customerHistory.length === 1) totals.new_sales += item.amount || 0;
        else if (index > 0 && item.product_name !== customerHistory[0]?.product_name)
          totals.cross_sale += item.amount || 0;
        else if (index > 0) totals.upsale += item.amount || 0;
      });

      const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
      const labels = { new_sales: "New Sales", upsale: "Up-sale", cross_sale: "Cross-sale" };
      const segments = Object.entries(totals).map(([key, amount]) => ({
        key,
        label: labels[key],
        amount,
        percentage: total ? Math.round((amount / total) * 1000) / 10 : 0
      }));
      return res.status(200).json({ data: { total, segments } });
    } catch (error) {
      return handleError(res, error, "getAumQuality");
    }
  },

  getInteractionKpi: async (req, res) => {
    try {
      const range = parseDateRange(req.query);
      const customerIdsInScope = await resolveScopedCustomerIds(req.account);
      const interactions = await CustomerInteractionModel.find({
        isDeleted: false,
        type: { $in: ["call", "message"] },
        ...scopedMatch("customer_id", customerIdsInScope),
        ...dateMatch("createdAt", range)
      })
        .select("customer_id sale_id")
        .lean();
      const customerIds = [...new Set(interactions.map((item) => String(item.customer_id)))];
      const saleIds = [
        ...new Set(interactions.map((item) => String(item.sale_id)).filter(Boolean))
      ];
      const rangeEnd = range.to || new Date();
      const rangeStart = range.from || new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
      const kpiPeriods = [];
      const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
      while (cursor <= endMonth && kpiPeriods.length < 24) {
        kpiPeriods.push({
          "period.month": cursor.getMonth() + 1,
          "period.year": cursor.getFullYear()
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      const [customers, investments, kpis] = await Promise.all([
        CustomerModel.find({ _id: { $in: customerIds }, isDeleted: false })
          .select("identity.verified_at")
          .lean(),
        InvestmentModel.find({ customer_id: { $in: customerIds }, isDeleted: false })
          .select("customer_id product_name status")
          .lean(),
        SaleKpiModel.find({
          isDeleted: false,
          ...(saleIds.length ? { sale_id: { $in: saleIds } } : { _id: null }),
          $or: kpiPeriods
        })
          .select("targets.interactions")
          .lean()
      ]);
      const customersById = new Map(customers.map((item) => [String(item._id), item]));
      const investmentsByCustomer = new Map();
      investments.forEach((item) => {
        const key = String(item.customer_id);
        if (!investmentsByCustomer.has(key)) investmentsByCustomer.set(key, []);
        investmentsByCustomer.get(key).push(item);
      });
      const actuals = Object.fromEntries(KPI_SEGMENTS.map((item) => [item.key, 0]));
      interactions.forEach((item) => {
        const key = String(item.customer_id);
        const segment = getCustomerSegment(
          customersById.get(key),
          investmentsByCustomer.get(key) || []
        );
        actuals[segment] += 1;
      });

      const configuredTargets = {};
      kpis.forEach((kpi) => {
        KPI_SEGMENTS.forEach((segment) => {
          configuredTargets[segment.key] =
            (configuredTargets[segment.key] || 0) + (kpi.targets?.interactions?.[segment.key] || 0);
        });
      });
      const segments = KPI_SEGMENTS.map((segment) => {
        const target = configuredTargets[segment.key] || segment.target;
        const actual = actuals[segment.key];
        return {
          key: segment.key,
          label: segment.label,
          actual,
          target,
          achievement: target ? Math.round((actual / target) * 1000) / 10 : 0
        };
      });
      return res.status(200).json({ data: { segments } });
    } catch (error) {
      return handleError(res, error, "getInteractionKpi");
    }
  }
};

module.exports = DashboardController;

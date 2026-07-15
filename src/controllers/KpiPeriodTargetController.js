const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const { getAccountTtkdIds, getSaleInfoIdsInTtkds } = require("../helpers/kpiHelper");
const { syncInvestmentRevenue, syncCifEkyc } = require("../helpers/kpiSync");
const { runDailyRollover } = require("../helpers/kpiRollover");
const { KPI_SCOPE_TYPE } = require("../constants");

async function canAccessRecord(account, record) {
  if (account.role === "admin") return true;
  const myTtkdIds = await getAccountTtkdIds(account._id);
  if (!myTtkdIds.length) return false;

  if (record.scope_type === KPI_SCOPE_TYPE.TTKD) {
    return myTtkdIds.some((id) => String(id) === String(record.scope_id));
  }

  const saleIds = await getSaleInfoIdsInTtkds(myTtkdIds);
  return saleIds.some((id) => String(id) === String(record.scope_id));
}

const KpiPeriodTargetController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.metric_code) filter.metric_code = req.query.metric_code;
      if (req.query.period_type) filter.period_type = req.query.period_type;
      if (req.query.period_key) filter.period_key = req.query.period_key;

      if (req.account.role === "admin") {
        if (req.query.scope_type) filter.scope_type = req.query.scope_type;
        if (req.query.scope_id) filter.scope_id = req.query.scope_id;
      } else {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        if (!myTtkdIds.length)
          return res.status(403).json({ message: "Tài khoản không thuộc TTKD nào" });

        const saleIds = await getSaleInfoIdsInTtkds(myTtkdIds);
        const scopeOr = [
          { scope_type: KPI_SCOPE_TYPE.TTKD, scope_id: { $in: myTtkdIds } },
          { scope_type: KPI_SCOPE_TYPE.SALE, scope_id: { $in: saleIds } }
        ];
        filter.$or = req.query.scope_type
          ? scopeOr.filter((s) => s.scope_type === req.query.scope_type)
          : scopeOr;
      }

      const records = await KpiPeriodTargetModel.find(filter)
        .sort({ period_key: -1, scope_type: 1 })
        .limit(Number(req.query.limit) > 0 ? Number(req.query.limit) : 500)
        .lean();

      return res.status(200).json({ message: "OK", data: records });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const record = await KpiPeriodTargetModel.findOne({
        _id: req.params.id,
        isDeleted: false
      }).lean();
      if (!record) return res.status(404).json({ message: "Không tìm thấy bản ghi" });

      if (!(await canAccessRecord(req.account, record)))
        return res.status(403).json({ message: "Không có quyền xem bản ghi này" });

      return res.status(200).json({ message: "OK", data: record });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  close: async (req, res) => {
    try {
      const record = await KpiPeriodTargetModel.findOne({
        _id: req.params.id,
        isDeleted: false
      });
      if (!record) return res.status(404).json({ message: "Không tìm thấy bản ghi" });

      if (!(await canAccessRecord(req.account, record)))
        return res.status(403).json({ message: "Không có quyền chốt bản ghi này" });

      if (record.is_closed) return res.status(409).json({ message: "Kỳ đã được chốt trước đó" });

      record.is_closed = true;
      record.closed_at = new Date();
      record.closed_by = req.account._id;
      await record.save();

      return res.status(200).json({ message: "Đã chốt kỳ", data: record });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  sync: async (req, res) => {
    try {
      const { year, month } = req.body;
      const { ttkd_id } = req.body;

      if (!year || !month)
        return res.status(400).json({ message: "Thiếu trường bắt buộc: year, month" });
      if (month < 1 || month > 12) return res.status(400).json({ message: "month phải từ 1–12" });

      if (req.account.role !== "admin") {
        if (!ttkd_id)
          return res.status(400).json({ message: "ttkd_id là bắt buộc với tài khoản non-admin" });
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(ttkd_id));
        if (!belongs) return res.status(403).json({ message: "Không có quyền đồng bộ TTKD này" });
      }

      const revenueSummary = await syncInvestmentRevenue({
        year: Number(year),
        month: Number(month),
        ttkdId: ttkd_id || null
      });
      const cifEkycSummary = await syncCifEkyc({
        year: Number(year),
        month: Number(month),
        ttkdId: ttkd_id || null
      });

      return res.status(200).json({
        message: "Đồng bộ hoàn tất",
        data: { investment_revenue: revenueSummary, cif_ekyc: cifEkycSummary }
      });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  rollover: async (req, res) => {
    try {
      const { date } = req.body;
      const parsedDate = date ? new Date(date) : new Date();
      if (Number.isNaN(parsedDate.getTime()))
        return res.status(400).json({ message: "date không hợp lệ" });

      const summary = await runDailyRollover({ date: parsedDate, closedBy: req.account._id });

      return res.status(200).json({ message: "Đã tính rollover", data: summary });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiPeriodTargetController;

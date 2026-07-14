const KpiTierConfigModel = require("../models/KpiTierConfigModel");
const KpiMetricModel = require("../models/KpiMetricModel");
const { getAccountTtkdIds } = require("../helpers/kpiHelper");

function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return "tiers không được rỗng";

  const levels = tiers.map((t) => t.level);
  if (new Set(levels).size !== levels.length) return "tiers có level bị trùng";

  for (const tier of tiers) {
    if (!Number.isInteger(tier.level) || tier.level < 1)
      return `level phải là số nguyên >= 1 (nhận được: ${tier.level})`;
    if (typeof tier.weight !== "number" || tier.weight < 0 || tier.weight > 1)
      return `weight của bậc ${tier.level} phải là số từ 0 đến 1`;
  }

  return null;
}

const KpiTierConfigController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.year) filter.year = Number(req.query.year);
      if (req.query.metric_code) filter.metric_code = req.query.metric_code;

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        if (!myTtkdIds.length)
          return res.status(403).json({ message: "Tài khoản không thuộc TTKD nào" });

        if (req.query.ttkd_id) {
          const belongs = myTtkdIds.some((id) => String(id) === String(req.query.ttkd_id));
          if (!belongs) return res.status(403).json({ message: "Không có quyền xem TTKD này" });
          filter.ttkd_id = req.query.ttkd_id;
        } else {
          filter.ttkd_id = { $in: myTtkdIds };
        }
      } else if (req.query.ttkd_id) {
        filter.ttkd_id = req.query.ttkd_id;
      }

      const configs = await KpiTierConfigModel.find(filter)
        .sort({ year: -1, metric_code: 1 })
        .populate("ttkd_id", "department_name department_code")
        .populate("configured_by", "username")
        .lean();

      return res.status(200).json({ message: "OK", data: configs });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const config = await KpiTierConfigModel.findOne({ _id: req.params.id, isDeleted: false })
        .populate("ttkd_id", "department_name department_code")
        .populate("configured_by", "username")
        .lean();

      if (!config) return res.status(404).json({ message: "Không tìm thấy cấu hình bậc" });
      return res.status(200).json({ message: "OK", data: config });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { ttkd_id, metric_code, year, tiers } = req.body;

      if (!ttkd_id || !metric_code || !year || !tiers)
        return res.status(400).json({
          message: "Thiếu trường bắt buộc: ttkd_id, metric_code, year, tiers"
        });

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(ttkd_id));
        if (!belongs) return res.status(403).json({ message: "Không có quyền cấu hình TTKD này" });
      }

      const tierError = validateTiers(tiers);
      if (tierError) return res.status(400).json({ message: tierError });

      const metric = await KpiMetricModel.findOne({
        code: metric_code,
        is_active: true,
        isDeleted: false
      }).lean();
      if (!metric)
        return res
          .status(400)
          .json({ message: `metric_code '${metric_code}' không tồn tại hoặc không active` });

      const config = await KpiTierConfigModel.create({
        ttkd_id,
        metric_code,
        year: Number(year),
        tiers,
        configured_by: req.account._id
      });

      return res.status(201).json({ message: "Đã tạo cấu hình bậc", data: config });
    } catch (err) {
      if (err.code === 11000)
        return res.status(409).json({
          message: "Cấu hình bậc cho TTKD + metric + năm này đã tồn tại"
        });
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const config = await KpiTierConfigModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!config) return res.status(404).json({ message: "Không tìm thấy cấu hình bậc" });

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(config.ttkd_id));
        if (!belongs) return res.status(403).json({ message: "Không có quyền cấu hình TTKD này" });
      }

      const { tiers } = req.body;
      if (tiers === undefined)
        return res.status(400).json({ message: "Thiếu trường bắt buộc: tiers" });

      const tierError = validateTiers(tiers);
      if (tierError) return res.status(400).json({ message: tierError });

      config.tiers = tiers;
      config.configured_by = req.account._id;
      await config.save();

      return res.status(200).json({ message: "Đã cập nhật cấu hình bậc", data: config });
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  remove: async (req, res) => {
    try {
      const config = await KpiTierConfigModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!config) return res.status(404).json({ message: "Không tìm thấy cấu hình bậc" });

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(config.ttkd_id));
        if (!belongs)
          return res.status(403).json({ message: "Không có quyền xóa cấu hình TTKD này" });
      }

      config.isDeleted = true;
      await config.save();
      return res.status(200).json({ message: "Đã xóa cấu hình bậc" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiTierConfigController;

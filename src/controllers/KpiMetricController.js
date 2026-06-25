const KpiMetricModel = require("../models/KpiMetricModel");
const { KPI_SOURCE, KPI_SOURCE_VALUES, KPI_AUTO_SOURCE_VALUES } = require("../constants");

function resolveAutoSource(source, auto_source) {
  if (source === KPI_SOURCE.MANUAL) return { auto_source: null };
  if (source === KPI_SOURCE.AUTO) {
    if (!auto_source) return { error: "source=auto thì auto_source là bắt buộc" };
    if (!KPI_AUTO_SOURCE_VALUES.includes(auto_source))
      return { error: `auto_source không hợp lệ. Cho phép: ${KPI_AUTO_SOURCE_VALUES.join(", ")}` };
    return { auto_source };
  }
  return { error: "source không hợp lệ" };
}

const KpiMetricController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.group) filter.group = req.query.group;
      if (req.query.source) {
        if (!KPI_SOURCE_VALUES.includes(req.query.source))
          return res
            .status(400)
            .json({ message: `source không hợp lệ. Cho phép: ${KPI_SOURCE_VALUES.join(", ")}` });
        filter.source = req.query.source;
      }
      if (req.query.is_active !== undefined) filter.is_active = req.query.is_active === "true";

      const metrics = await KpiMetricModel.find(filter).sort({ order: 1, code: 1 }).lean();
      return res.status(200).json({ message: "OK", data: metrics });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const metric = await KpiMetricModel.findOne({ _id: req.params.id, isDeleted: false }).lean();
      if (!metric) return res.status(404).json({ message: "Không tìm thấy metric" });
      return res.status(200).json({ message: "OK", data: metric });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { code, name, group, unit, source, auto_source, description, order, is_active } =
        req.body;
      if (!code || !name || !group || !source)
        return res
          .status(400)
          .json({ message: "Thiếu trường bắt buộc: code, name, group, source" });

      const resolved = resolveAutoSource(source, auto_source);
      if (resolved.error) return res.status(400).json({ message: resolved.error });

      const normalizedCode = String(code).trim();
      const metric = await KpiMetricModel.create({
        code: normalizedCode,
        name,
        group,
        unit: unit || "",
        source,
        auto_source: resolved.auto_source,
        description: description || "",
        order: order ?? 0,
        is_active: is_active ?? true
      });
      return res.status(201).json({ message: "Đã tạo metric", data: metric });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ message: `Metric code đã tồn tại` });
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server" });
    }
  },

  update: async (req, res) => {
    try {
      const metric = await KpiMetricModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!metric) return res.status(404).json({ message: "Không tìm thấy metric" });

      if (req.body.code !== undefined && String(req.body.code).trim() !== metric.code)
        return res.status(400).json({ message: "Không được sửa 'code' của metric" });

      const { source, auto_source } = req.body;

      if (source !== undefined || auto_source !== undefined) {
        const nextSource = source !== undefined ? source : metric.source;
        const nextAuto = auto_source !== undefined ? auto_source : metric.auto_source;
        const resolved = resolveAutoSource(nextSource, nextAuto);
        if (resolved.error) return res.status(400).json({ message: resolved.error });
        metric.source = nextSource;
        metric.auto_source = resolved.auto_source;
      }

      const UPDATABLE_FIELDS = ["name", "group", "unit", "description", "order", "is_active"];
      for (const field of UPDATABLE_FIELDS) {
        if (req.body[field] !== undefined) metric[field] = req.body[field];
      }

      await metric.save();
      return res.status(200).json({ message: "Đã cập nhật metric", data: metric });
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  remove: async (req, res) => {
    try {
      const metric = await KpiMetricModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!metric) return res.status(404).json({ message: "Không tìm thấy metric" });

      metric.isDeleted = true;
      await metric.save();
      return res.status(200).json({ message: "Đã xóa metric" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiMetricController;

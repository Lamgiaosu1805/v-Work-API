const mongoose = require("mongoose");
const KpiAssignmentModel = require("../models/KpiAssignmentModel");
const KpiMetricModel = require("../models/KpiMetricModel");
const { KPI_ASSIGNMENT_STATUS } = require("../constants");

const { DRAFT, ACTIVE, SUPERSEDED } = KPI_ASSIGNMENT_STATUS;

async function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "items không được rỗng";

  const codes = items.map((i) => i.metric_code);
  const uniqueCodes = new Set(codes);
  if (uniqueCodes.size !== codes.length) return "items có metric_code bị trùng";

  const activeMetrics = await KpiMetricModel.find({
    code: { $in: codes },
    is_active: true,
    isDeleted: false
  })
    .select("code")
    .lean();

  const foundCodes = new Set(activeMetrics.map((m) => m.code));
  const missing = codes.filter((c) => !foundCodes.has(c));
  if (missing.length) return `metric_code không tồn tại hoặc không active: ${missing.join(", ")}`;

  const invalidTarget = items.find((i) => typeof i.target !== "number" || i.target < 0);
  if (invalidTarget) return `target của '${invalidTarget.metric_code}' phải là số >= 0`;

  return null;
}

const KpiAssignmentController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.sale_id) filter.sale_id = req.query.sale_id;
      if (req.query.ttkd_id) filter.ttkd_id = req.query.ttkd_id;
      if (req.query.year) filter.year = Number(req.query.year);
      if (req.query.month) filter.month = Number(req.query.month);
      if (req.query.status) filter.status = req.query.status;

      const assignments = await KpiAssignmentModel.find(filter)
        .sort({ year: -1, month: -1, version: -1 })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .populate("assigned_by", "username")
        .lean();

      return res.status(200).json({ message: "OK", data: assignments });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const assignment = await KpiAssignmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .populate("assigned_by", "username")
        .lean();

      if (!assignment) return res.status(404).json({ message: "Không tìm thấy assignment" });
      return res.status(200).json({ message: "OK", data: assignment });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { sale_id, ttkd_id, year, month, items, note } = req.body;

      if (!sale_id || !ttkd_id || !year || !month || !items)
        return res
          .status(400)
          .json({ message: "Thiếu trường bắt buộc: sale_id, ttkd_id, year, month, items" });

      const itemError = await validateItems(items);
      if (itemError) return res.status(400).json({ message: itemError });

      const latest = await KpiAssignmentModel.findOne({ sale_id, year, month }, { version: 1 })
        .sort({ version: -1 })
        .lean();
      const version = latest ? latest.version + 1 : 1;

      const assignment = await KpiAssignmentModel.create({
        sale_id,
        ttkd_id,
        assigned_by: req.account._id,
        year,
        month,
        version,
        items,
        note: note || "",
        status: DRAFT
      });

      return res.status(201).json({ message: "Đã tạo assignment (draft)", data: assignment });
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const assignment = await KpiAssignmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      });
      if (!assignment) return res.status(404).json({ message: "Không tìm thấy assignment" });
      if (assignment.status !== DRAFT)
        return res.status(409).json({ message: "Chỉ sửa được assignment ở trạng thái draft" });

      const { items, note } = req.body;

      if (items !== undefined) {
        const itemError = await validateItems(items);
        if (itemError) return res.status(400).json({ message: itemError });
        assignment.items = items;
      }
      if (note !== undefined) assignment.note = note;

      await assignment.save();
      return res.status(200).json({ message: "Đã cập nhật assignment", data: assignment });
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  activate: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const assignment = await KpiAssignmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      }).session(session);
      if (!assignment) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Không tìm thấy assignment" });
      }
      if (assignment.status === ACTIVE) {
        await session.abortTransaction();
        return res.status(409).json({ message: "Assignment đã active" });
      }
      if (assignment.status === SUPERSEDED) {
        await session.abortTransaction();
        return res
          .status(409)
          .json({ message: "Assignment đã bị supersede, không thể activate lại" });
      }

      await KpiAssignmentModel.updateOne(
        {
          sale_id: assignment.sale_id,
          year: assignment.year,
          month: assignment.month,
          status: ACTIVE
        },
        { $set: { status: SUPERSEDED } },
        { session }
      );

      assignment.status = ACTIVE;
      assignment.activated_at = new Date();
      await assignment.save({ session });

      await session.commitTransaction();
      return res.status(200).json({ message: "Đã activate assignment", data: assignment });
    } catch (err) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    } finally {
      session.endSession();
    }
  },

  remove: async (req, res) => {
    try {
      const assignment = await KpiAssignmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      });
      if (!assignment) return res.status(404).json({ message: "Không tìm thấy assignment" });
      if (assignment.status !== DRAFT)
        return res.status(409).json({ message: "Chỉ xóa được assignment ở trạng thái draft" });

      assignment.isDeleted = true;
      await assignment.save();
      return res.status(200).json({ message: "Đã xóa assignment" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiAssignmentController;

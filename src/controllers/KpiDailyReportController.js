const mongoose = require("mongoose");
const KpiDailyReportModel = require("../models/KpiDailyReportModel");
const KpiMetricModel = require("../models/KpiMetricModel");
const { KPI_DAILY_REPORT_STATUS } = require("../constants");
const {
  getAccountTtkdIds,
  getSaleTtkdId,
  getUserInfoIdFromAccount
} = require("../helpers/kpiHelper");
const { diffItems, applyReportDelta } = require("../helpers/kpiDailyReport");

const { DRAFT, SUBMITTED } = KPI_DAILY_REPORT_STATUS;

async function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "items không được rỗng";

  const codes = items.map((i) => i.metric_code);
  const uniqueCodes = new Set(codes);
  if (uniqueCodes.size !== codes.length) return "items có metric_code bị trùng";

  const activeMetrics = await KpiMetricModel.find({
    code: { $in: codes },
    group: "input",
    is_active: true,
    isDeleted: false
  })
    .select("code")
    .lean();

  const foundCodes = new Set(activeMetrics.map((m) => m.code));
  const missing = codes.filter((c) => !foundCodes.has(c));
  if (missing.length)
    return `metric_code không phải Input KPI đang active: ${missing.join(", ")}`;

  const invalidValue = items.find((i) => typeof i.value !== "number" || i.value < 0);
  if (invalidValue) return `value của '${invalidValue.metric_code}' phải là số >= 0`;

  return null;
}

async function canAccessTtkd(req, ttkdId) {
  if (req.account.role === "admin") return true;
  const myTtkdIds = await getAccountTtkdIds(req.account._id);
  return myTtkdIds.some((id) => String(id) === String(ttkdId));
}

const KpiDailyReportController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.sale_id) filter.sale_id = req.query.sale_id;
      if (req.query.status) filter.status = req.query.status;
      if (req.query.date) filter.date = new Date(req.query.date);

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

      const reports = await KpiDailyReportModel.find(filter)
        .sort({ date: -1 })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .lean();

      return res.status(200).json({ message: "OK", data: reports });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const report = await KpiDailyReportModel.findOne({ _id: req.params.id, isDeleted: false })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .lean();
      if (!report) return res.status(404).json({ message: "Không tìm thấy báo cáo" });

      if (!(await canAccessTtkd(req, report.ttkd_id?._id || report.ttkd_id)))
        return res.status(403).json({ message: "Không có quyền xem báo cáo này" });

      return res.status(200).json({ message: "OK", data: report });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { date, items, note } = req.body;
      if (!date || !items)
        return res.status(400).json({ message: "Thiếu trường bắt buộc: date, items" });

      const itemError = await validateItems(items);
      if (itemError) return res.status(400).json({ message: itemError });

      const saleId = await getUserInfoIdFromAccount(req.account._id);
      if (!saleId)
        return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
      const ttkdId = await getSaleTtkdId(saleId);
      if (!ttkdId) return res.status(400).json({ message: "Tài khoản không thuộc TTKD nào" });

      const reportDate = new Date(date);
      const existing = await KpiDailyReportModel.findOne({
        sale_id: saleId,
        date: reportDate,
        isDeleted: false
      });

      if (existing) {
        if (existing.status !== DRAFT)
          return res
            .status(409)
            .json({ message: "Báo cáo ngày này đã submitted — dùng update để sửa" });
        existing.items = items;
        if (note !== undefined) existing.note = note;
        await existing.save();
        return res.status(200).json({ message: "Đã cập nhật báo cáo (draft)", data: existing });
      }

      const report = await KpiDailyReportModel.create({
        sale_id: saleId,
        ttkd_id: ttkdId,
        date: reportDate,
        items,
        note: note || "",
        status: DRAFT
      });

      return res.status(201).json({ message: "Đã tạo báo cáo (draft)", data: report });
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const report = await KpiDailyReportModel.findOne({
        _id: req.params.id,
        isDeleted: false
      });
      if (!report) return res.status(404).json({ message: "Không tìm thấy báo cáo" });

      const saleId = await getUserInfoIdFromAccount(req.account._id);
      if (String(report.sale_id) !== String(saleId) && req.account.role !== "admin")
        return res.status(403).json({ message: "Không có quyền sửa báo cáo này" });

      const { items, note } = req.body;
      if (items === undefined)
        return res.status(400).json({ message: "Thiếu trường items" });

      const itemError = await validateItems(items);
      if (itemError) return res.status(400).json({ message: itemError });

      if (report.status === DRAFT) {
        report.items = items;
        if (note !== undefined) report.note = note;
        await report.save();
        return res.status(200).json({ message: "Đã cập nhật báo cáo (draft)", data: report });
      }

      const deltaItems = diffItems(report.items, items);
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const applyResult = await applyReportDelta({
          saleId: report.sale_id,
          ttkdId: report.ttkd_id,
          date: report.date,
          deltaItems,
          session
        });

        report.items = items;
        if (note !== undefined) report.note = note;
        await report.save({ session });

        await session.commitTransaction();
        return res.status(200).json({
          message: "Đã cập nhật báo cáo (submitted) và điều chỉnh actual",
          data: report,
          apply: applyResult
        });
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  submit: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const report = await KpiDailyReportModel.findOne({
        _id: req.params.id,
        isDeleted: false
      }).session(session);
      if (!report) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Không tìm thấy báo cáo" });
      }

      const saleId = await getUserInfoIdFromAccount(req.account._id);
      if (String(report.sale_id) !== String(saleId) && req.account.role !== "admin") {
        await session.abortTransaction();
        return res.status(403).json({ message: "Không có quyền submit báo cáo này" });
      }
      if (report.status !== DRAFT) {
        await session.abortTransaction();
        return res.status(409).json({ message: "Báo cáo đã submitted" });
      }
      if (!report.items.length) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Báo cáo chưa có items" });
      }

      const deltaItems = diffItems([], report.items);
      const applyResult = await applyReportDelta({
        saleId: report.sale_id,
        ttkdId: report.ttkd_id,
        date: report.date,
        deltaItems,
        session
      });

      report.status = SUBMITTED;
      report.submitted_at = new Date();
      await report.save({ session });

      await session.commitTransaction();
      return res
        .status(200)
        .json({ message: "Đã submit báo cáo", data: report, apply: applyResult });
    } catch (err) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    } finally {
      session.endSession();
    }
  },

  remove: async (req, res) => {
    try {
      const report = await KpiDailyReportModel.findOne({
        _id: req.params.id,
        isDeleted: false
      });
      if (!report) return res.status(404).json({ message: "Không tìm thấy báo cáo" });

      const saleId = await getUserInfoIdFromAccount(req.account._id);
      if (String(report.sale_id) !== String(saleId) && req.account.role !== "admin")
        return res.status(403).json({ message: "Không có quyền xóa báo cáo này" });
      if (report.status !== DRAFT)
        return res.status(409).json({ message: "Chỉ xóa được báo cáo ở trạng thái draft" });

      report.isDeleted = true;
      await report.save();
      return res.status(200).json({ message: "Đã xóa báo cáo" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiDailyReportController;

const mongoose = require("mongoose");
const KpiYearPlanModel = require("../models/KpiYearPlanModel");
const KpiMetricModel = require("../models/KpiMetricModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const DepartmentModel = require("../models/DepartmentModel");
const { KPI_YEAR_PLAN_STATUS } = require("../constants");

const { DRAFT, ACTIVE, SUPERSEDED } = KPI_YEAR_PLAN_STATUS;

async function getAccountTtkdIds(accountId) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false })
    .select("_id")
    .lean();
  if (!userInfo) return [];

  const deptIds = await UserDepartmentPositionModel.distinct("department", {
    user: userInfo._id,
    isDeleted: false
  });
  if (!deptIds.length) return [];

  const ttkds = await DepartmentModel.find({
    _id: { $in: deptIds },
    type: "branch",
    isDeleted: false
  })
    .select("_id")
    .lean();

  return ttkds.map((t) => t._id);
}

function decomposeEqual(yearTarget) {
  const monthly = yearTarget / 12;
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    base_target: monthly,
    adjusted_target: monthly,
    is_adjusted: false
  }));
}

const KpiYearPlanController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.year) filter.year = Number(req.query.year);
      if (req.query.metric_code) filter.metric_code = req.query.metric_code;
      if (req.query.status) filter.status = req.query.status;

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

      const plans = await KpiYearPlanModel.find(filter)
        .sort({ year: -1, version: -1 })
        .populate("ttkd_id", "department_name department_code")
        .populate("created_by", "username")
        .lean();

      return res.status(200).json({ message: "OK", data: plans });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const plan = await KpiYearPlanModel.findOne({ _id: req.params.id, isDeleted: false })
        .populate("ttkd_id", "department_name department_code")
        .populate("created_by", "username")
        .lean();

      if (!plan) return res.status(404).json({ message: "Không tìm thấy kế hoạch năm" });
      return res.status(200).json({ message: "OK", data: plan });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { ttkd_id, year, metric_code, year_target, note } = req.body;

      if (!ttkd_id || !year || !metric_code || year_target === undefined)
        return res.status(400).json({
          message: "Thiếu trường bắt buộc: ttkd_id, year, metric_code, year_target"
        });

      if (typeof year_target !== "number" || year_target < 0)
        return res.status(400).json({ message: "year_target phải là số >= 0" });

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(ttkd_id));
        if (!belongs)
          return res.status(403).json({ message: "Không có quyền tạo kế hoạch cho TTKD này" });
      }

      const ttkdId = ttkd_id;

      const metric = await KpiMetricModel.findOne({
        code: metric_code,
        is_active: true,
        isDeleted: false
      }).lean();
      if (!metric)
        return res
          .status(400)
          .json({ message: `metric_code '${metric_code}' không tồn tại hoặc không active` });

      const latest = await KpiYearPlanModel.findOne(
        { ttkd_id: ttkdId, year, metric_code, isDeleted: false },
        { version: 1 }
      )
        .sort({ version: -1 })
        .lean();
      const version = latest ? latest.version + 1 : 1;

      const plan = await KpiYearPlanModel.create({
        ttkd_id: ttkdId,
        year: Number(year),
        metric_code,
        year_target,
        monthly_targets: decomposeEqual(year_target),
        version,
        status: DRAFT,
        created_by: req.account._id,
        note: note || ""
      });

      return res.status(201).json({ message: "Đã tạo kế hoạch năm (draft)", data: plan });
    } catch (err) {
      if (err.code === 11000)
        return res.status(409).json({ message: "Trùng version kế hoạch năm, vui lòng thử lại" });
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const plan = await KpiYearPlanModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!plan) return res.status(404).json({ message: "Không tìm thấy kế hoạch năm" });
      if (plan.status !== DRAFT)
        return res.status(409).json({ message: "Chỉ sửa được kế hoạch ở trạng thái draft" });

      const { year_target, note } = req.body;

      if (year_target !== undefined) {
        if (typeof year_target !== "number" || year_target < 0)
          return res.status(400).json({ message: "year_target phải là số >= 0" });
        plan.year_target = year_target;
        plan.monthly_targets = decomposeEqual(year_target);
      }
      if (note !== undefined) plan.note = note;

      await plan.save();
      return res.status(200).json({ message: "Đã cập nhật kế hoạch năm", data: plan });
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
      const plan = await KpiYearPlanModel.findOne({
        _id: req.params.id,
        isDeleted: false
      }).session(session);

      if (!plan) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Không tìm thấy kế hoạch năm" });
      }
      if (plan.status === ACTIVE) {
        await session.abortTransaction();
        return res.status(409).json({ message: "Kế hoạch đã active" });
      }
      if (plan.status === SUPERSEDED) {
        await session.abortTransaction();
        return res
          .status(409)
          .json({ message: "Kế hoạch đã bị supersede, không thể activate lại" });
      }

      await KpiYearPlanModel.updateOne(
        {
          ttkd_id: plan.ttkd_id,
          year: plan.year,
          metric_code: plan.metric_code,
          status: ACTIVE
        },
        { $set: { status: SUPERSEDED } },
        { session }
      );

      plan.status = ACTIVE;
      plan.activated_at = new Date();
      await plan.save({ session });

      await session.commitTransaction();
      return res.status(200).json({ message: "Đã activate kế hoạch năm", data: plan });
    } catch (err) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    } finally {
      session.endSession();
    }
  },

  adjustMonthly: async (req, res) => {
    try {
      const plan = await KpiYearPlanModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!plan) return res.status(404).json({ message: "Không tìm thấy kế hoạch năm" });
      if (plan.status === SUPERSEDED)
        return res.status(409).json({ message: "Không thể điều chỉnh kế hoạch đã bị supersede" });

      const { adjustments } = req.body;
      if (!Array.isArray(adjustments) || adjustments.length === 0)
        return res.status(400).json({ message: "adjustments không được rỗng" });

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      for (const adj of adjustments) {
        const month = Number(adj.month);
        if (!month || month < 1 || month > 12)
          return res.status(400).json({ message: "month phải là số từ 1–12" });
        if (adj.adjusted_target === undefined)
          return res.status(400).json({ message: `Thiếu adjusted_target cho tháng ${month}` });
        if (typeof adj.adjusted_target !== "number" || adj.adjusted_target < 0)
          return res
            .status(400)
            .json({ message: `adjusted_target tháng ${month} phải là số >= 0` });

        const isPastMonth =
          plan.year < currentYear || (plan.year === currentYear && month < currentMonth);
        if (isPastMonth)
          return res
            .status(409)
            .json({ message: `Tháng ${month}/${plan.year} đã qua, không thể điều chỉnh` });

        const entry = plan.monthly_targets.find((t) => t.month === month);
        if (!entry)
          return res.status(400).json({ message: `Không tìm thấy tháng ${month} trong kế hoạch` });

        entry.adjusted_target = adj.adjusted_target;
        entry.is_adjusted = adj.adjusted_target !== entry.base_target;
      }

      plan.markModified("monthly_targets");
      await plan.save();
      return res.status(200).json({ message: "Đã điều chỉnh chỉ tiêu tháng", data: plan });
    } catch (err) {
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  remove: async (req, res) => {
    try {
      const plan = await KpiYearPlanModel.findOne({ _id: req.params.id, isDeleted: false });
      if (!plan) return res.status(404).json({ message: "Không tìm thấy kế hoạch năm" });
      if (plan.status !== DRAFT)
        return res.status(409).json({ message: "Chỉ xóa được kế hoạch ở trạng thái draft" });

      plan.isDeleted = true;
      await plan.save();
      return res.status(200).json({ message: "Đã xóa kế hoạch năm" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiYearPlanController;

const mongoose = require("mongoose");
const KpiTierAssignmentModel = require("../models/KpiTierAssignmentModel");
const UserInfoModel = require("../models/UserInfoModel");
const { getAccountTtkdIds } = require("../helpers/kpiHelper");

const KpiTierAssignmentController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.sale_id) filter.sale_id = req.query.sale_id;
      if (req.query.active_only === "true") filter.effective_to = null;

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

      const assignments = await KpiTierAssignmentModel.find(filter)
        .sort({ effective_from: -1 })
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
      const assignment = await KpiTierAssignmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .populate("assigned_by", "username")
        .lean();

      if (!assignment) return res.status(404).json({ message: "Không tìm thấy gán bậc" });
      return res.status(200).json({ message: "OK", data: assignment });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  assign: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { sale_id, ttkd_id, tier_level } = req.body;

      if (!sale_id || !ttkd_id || tier_level === undefined) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ message: "Thiếu trường bắt buộc: sale_id, ttkd_id, tier_level" });
      }

      if (!Number.isInteger(tier_level) || tier_level < 1) {
        await session.abortTransaction();
        return res.status(400).json({ message: "tier_level phải là số nguyên >= 1" });
      }

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(ttkd_id));
        if (!belongs) {
          await session.abortTransaction();
          return res.status(403).json({ message: "Không có quyền gán bậc cho TTKD này" });
        }
      }

      const saleInfo = await UserInfoModel.findOne({ _id: sale_id, isDeleted: false })
        .select("_id")
        .lean();
      if (!saleInfo) {
        await session.abortTransaction();
        return res.status(400).json({ message: "sale_id không tồn tại" });
      }

      const now = new Date();

      await KpiTierAssignmentModel.updateOne(
        { sale_id, ttkd_id, effective_to: null, isDeleted: false },
        { $set: { effective_to: now } },
        { session }
      );

      const assignment = await KpiTierAssignmentModel.create(
        [
          {
            sale_id,
            ttkd_id,
            tier_level,
            assigned_by: req.account._id,
            effective_from: now,
            effective_to: null
          }
        ],
        { session }
      );

      await session.commitTransaction();
      return res.status(201).json({ message: "Đã gán bậc cho Sale", data: assignment[0] });
    } catch (err) {
      await session.abortTransaction();
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    } finally {
      session.endSession();
    }
  },

  remove: async (req, res) => {
    try {
      const assignment = await KpiTierAssignmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      });
      if (!assignment) return res.status(404).json({ message: "Không tìm thấy gán bậc" });

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(assignment.ttkd_id));
        if (!belongs)
          return res.status(403).json({ message: "Không có quyền xóa gán bậc của TTKD này" });
      }

      assignment.isDeleted = true;
      await assignment.save();
      return res.status(200).json({ message: "Đã xóa gán bậc" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiTierAssignmentController;

const mongoose = require("mongoose");
const KpiAdjustmentModel = require("../models/KpiAdjustmentModel");
const InvestmentModel = require("../models/InvestmentModel");
const { getAccountTtkdIds, getSaleInfoIdsInTtkds, getSaleTtkdId } = require("../helpers/kpiHelper");
const { resolvePeriodsToApply, applyActualDelta } = require("../helpers/kpiClawback");
const { KPI_SCOPE_TYPE, KPI_ADJUSTMENT_REASON_VALUES } = require("../constants");

const METRIC_CODE = "investment_revenue";

const KpiAdjustmentController = {
  list: async (req, res) => {
    try {
      const filter = { isDeleted: false };
      if (req.query.investment_id) filter.investment_id = req.query.investment_id;
      if (req.query.sale_id) filter.sale_id = req.query.sale_id;
      if (req.query.reason) filter.reason = req.query.reason;
      if (req.query.period_type) filter.period_type = req.query.period_type;

      if (req.account.role === "admin") {
        if (req.query.ttkd_id) filter.ttkd_id = req.query.ttkd_id;
      } else {
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
      }

      const records = await KpiAdjustmentModel.find(filter)
        .sort({ withdrawal_date: -1 })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .populate("created_by", "username")
        .lean();

      return res.status(200).json({ message: "OK", data: records });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getById: async (req, res) => {
    try {
      const record = await KpiAdjustmentModel.findOne({ _id: req.params.id, isDeleted: false })
        .populate("sale_id", "full_name code")
        .populate("ttkd_id", "department_name department_code")
        .populate("created_by", "username")
        .lean();
      if (!record) return res.status(404).json({ message: "Không tìm thấy bản ghi clawback" });

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(record.ttkd_id?._id));
        if (!belongs) return res.status(403).json({ message: "Không có quyền xem bản ghi này" });
      }

      return res.status(200).json({ message: "OK", data: record });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { investment_id, reason, note } = req.body;
      let { withdrawal_date, amount } = req.body;

      if (!investment_id || !reason) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Thiếu trường bắt buộc: investment_id, reason" });
      }
      if (!KPI_ADJUSTMENT_REASON_VALUES.includes(reason)) {
        await session.abortTransaction();
        return res.status(400).json({
          message: `reason không hợp lệ, phải thuộc: ${KPI_ADJUSTMENT_REASON_VALUES.join(", ")}`
        });
      }

      const investment = await InvestmentModel.findOne({
        _id: investment_id,
        isDeleted: false
      }).session(session);
      if (!investment) {
        await session.abortTransaction();
        return res.status(400).json({ message: "investment_id không tồn tại" });
      }
      if (!investment.commission?.sale_id) {
        await session.abortTransaction();
        return res
          .status(400)
          .json({ message: "Khoản đầu tư không gắn Sale (commission.sale_id) — không tính KPI" });
      }

      const existingAdjustment = await KpiAdjustmentModel.findOne({
        investment_id,
        isDeleted: false
      }).session(session);
      if (existingAdjustment) {
        await session.abortTransaction();
        return res
          .status(409)
          .json({ message: "Khoản đầu tư này đã được ghi nhận clawback trước đó" });
      }

      const saleId = investment.commission.sale_id;
      const ttkdId = await getSaleTtkdId(saleId);
      if (!ttkdId) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Sale của khoản đầu tư này không thuộc TTKD nào" });
      }

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(ttkdId));
        if (!belongs) {
          await session.abortTransaction();
          return res.status(403).json({ message: "Không có quyền clawback cho TTKD này" });
        }
      }

      amount = amount !== undefined ? amount : investment.amount;
      if (typeof amount !== "number" || amount < 0) {
        await session.abortTransaction();
        return res.status(400).json({ message: "amount phải là số >= 0" });
      }
      withdrawal_date = withdrawal_date ? new Date(withdrawal_date) : new Date();

      const periods = await resolvePeriodsToApply({
        investedAt: investment.invested_at,
        saleId,
        metricCode: METRIC_CODE
      });

      const createdAdjustments = [];
      for (const p of periods) {
        const [adj] = await KpiAdjustmentModel.create(
          [
            {
              investment_id,
              sale_id: saleId,
              ttkd_id: ttkdId,
              metric_code: METRIC_CODE,
              amount,
              reason,
              withdrawal_date,
              period_type: p.period_type,
              applied_period_key: p.period_key,
              note: note || "",
              created_by: req.account._id
            }
          ],
          { session }
        );
        createdAdjustments.push(adj);

        await applyActualDelta({
          scopeType: KPI_SCOPE_TYPE.SALE,
          scopeId: saleId,
          metricCode: METRIC_CODE,
          periodType: p.period_type,
          periodKey: p.period_key,
          delta: -amount,
          session
        });
        await applyActualDelta({
          scopeType: KPI_SCOPE_TYPE.TTKD,
          scopeId: ttkdId,
          metricCode: METRIC_CODE,
          periodType: p.period_type,
          periodKey: p.period_key,
          delta: -amount,
          session
        });
      }

      await session.commitTransaction();
      return res.status(201).json({
        message: "Đã ghi nhận clawback",
        data: { adjustments: createdAdjustments, amount, periods_applied: periods }
      });
    } catch (err) {
      await session.abortTransaction();
      if (err.name === "ValidationError")
        return res.status(400).json({ message: "Dữ liệu không hợp lệ", error: err.message });
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    } finally {
      session.endSession();
    }
  },

  // Hủy 1 bản ghi clawback — hoàn lại actual đã trừ, soft delete bản ghi
  remove: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const record = await KpiAdjustmentModel.findOne({
        _id: req.params.id,
        isDeleted: false
      }).session(session);
      if (!record) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Không tìm thấy bản ghi clawback" });
      }

      if (req.account.role !== "admin") {
        const myTtkdIds = await getAccountTtkdIds(req.account._id);
        const belongs = myTtkdIds.some((id) => String(id) === String(record.ttkd_id));
        if (!belongs) {
          await session.abortTransaction();
          return res.status(403).json({ message: "Không có quyền hủy bản ghi này" });
        }
      }

      await applyActualDelta({
        scopeType: KPI_SCOPE_TYPE.SALE,
        scopeId: record.sale_id,
        metricCode: record.metric_code,
        periodType: record.period_type,
        periodKey: record.applied_period_key,
        delta: record.amount,
        session
      });
      await applyActualDelta({
        scopeType: KPI_SCOPE_TYPE.TTKD,
        scopeId: record.ttkd_id,
        metricCode: record.metric_code,
        periodType: record.period_type,
        periodKey: record.applied_period_key,
        delta: record.amount,
        session
      });

      record.isDeleted = true;
      await record.save({ session });

      await session.commitTransaction();
      return res.status(200).json({ message: "Đã hủy clawback và hoàn lại actual" });
    } catch (err) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    } finally {
      session.endSession();
    }
  }
};

module.exports = KpiAdjustmentController;

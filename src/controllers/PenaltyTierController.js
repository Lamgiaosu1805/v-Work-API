const moment = require("moment-timezone");
const AttendancePenaltyTierModel = require("../models/AttendancePenaltyModel");

const TZ = "Asia/Ho_Chi_Minh";

const PenaltyTierController = {
  getTiers: async (req, res) => {
    try {
      const { type } = req.query;
      const filter = { isDeleted: false };
      if (type) filter.type = type;

      const tiers = await AttendancePenaltyTierModel.find(filter).sort({
        effective_from: -1,
        from_minutes: 1,
      });
      res.json({ message: "OK", data: tiers });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  createGeneration: async (req, res) => {
    try {
      const { type = "late", effective_from, tiers } = req.body;
      if (!effective_from || !Array.isArray(tiers) || !tiers.length)
        return res.status(400).json({ message: "effective_from và tiers là bắt buộc" });

      const effMoment = moment.tz(effective_from, TZ).startOf("day");
      if (!effMoment.isValid())
        return res.status(400).json({ message: "effective_from không hợp lệ" });

      for (const t of tiers) {
        if (t.from_minutes == null || !t.penalty_kind || t.penalty_value == null)
          return res.status(400).json({
            message: "Mỗi tier cần from_minutes, penalty_kind, penalty_value",
          });
        if (!["money", "work_unit"].includes(t.penalty_kind))
          return res.status(400).json({ message: `penalty_kind không hợp lệ: ${t.penalty_kind}` });
      }

      const docs = tiers.map((t) => ({
        type,
        from_minutes: t.from_minutes,
        to_minutes: t.to_minutes ?? null,
        penalty_kind: t.penalty_kind,
        penalty_value: t.penalty_value,
        effective_from: effMoment.toDate(),
        description: t.description || "",
        is_active: t.is_active !== false,
      }));

      const created = await AttendancePenaltyTierModel.insertMany(docs);
      res.status(201).json({ message: `Tạo ${created.length} tier thành công`, data: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  updateTier: async (req, res) => {
    try {
      const { id } = req.params;
      const { from_minutes, to_minutes, penalty_kind, penalty_value, description, is_active, effective_from } = req.body;

      const tier = await AttendancePenaltyTierModel.findOne({ _id: id, isDeleted: false });
      if (!tier) return res.status(404).json({ message: "Không tìm thấy tier" });

      if (from_minutes != null) tier.from_minutes = from_minutes;
      if (to_minutes !== undefined) tier.to_minutes = to_minutes;
      if (penalty_kind) {
        if (!["money", "work_unit"].includes(penalty_kind))
          return res.status(400).json({ message: "penalty_kind không hợp lệ" });
        tier.penalty_kind = penalty_kind;
      }
      if (penalty_value != null) tier.penalty_value = penalty_value;
      if (description != null) tier.description = description;
      if (is_active != null) tier.is_active = is_active;
      if (effective_from) {
        const effMoment = moment.tz(effective_from, TZ).startOf("day");
        if (!effMoment.isValid())
          return res.status(400).json({ message: "effective_from không hợp lệ" });
        tier.effective_from = effMoment.toDate();
      }

      await tier.save();
      res.json({ message: "Cập nhật thành công", data: tier });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  deleteTier: async (req, res) => {
    try {
      const { id } = req.params;
      const tier = await AttendancePenaltyTierModel.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { isDeleted: true },
        { new: true },
      );
      if (!tier) return res.status(404).json({ message: "Không tìm thấy tier" });
      res.json({ message: "Xóa tier thành công" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
};

module.exports = PenaltyTierController;

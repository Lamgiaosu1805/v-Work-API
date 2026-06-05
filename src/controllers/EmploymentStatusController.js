const EmploymentStatusModel = require("../models/EmploymentStatusModel");

const EmploymentStatusController = {
  list: async (req, res) => {
    try {
      const statuses = await EmploymentStatusModel.find({ isDeleted: false }).sort({ createdAt: 1 });
      res.json({ message: "OK", data: statuses });
    } catch (err) {
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, code, accrues_annual_leave, can_use_annual_leave, retroactive_on_promote } = req.body;
      if (!name || !code)
        return res.status(400).json({ message: "name và code là bắt buộc" });

      const existing = await EmploymentStatusModel.findOne({ code: code.trim(), isDeleted: false });
      if (existing)
        return res.status(409).json({ message: "Code đã tồn tại" });

      const status = await EmploymentStatusModel.create({
        name: name.trim(),
        code: code.trim(),
        accrues_annual_leave: !!accrues_annual_leave,
        can_use_annual_leave: !!can_use_annual_leave,
        retroactive_on_promote: !!retroactive_on_promote,
      });
      res.status(201).json({ message: "Tạo thành công", data: status });
    } catch (err) {
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, accrues_annual_leave, can_use_annual_leave, retroactive_on_promote, isActive } = req.body;

      const status = await EmploymentStatusModel.findOne({ _id: id, isDeleted: false });
      if (!status)
        return res.status(404).json({ message: "Không tìm thấy" });

      if (name !== undefined) status.name = name.trim();
      if (accrues_annual_leave !== undefined) status.accrues_annual_leave = !!accrues_annual_leave;
      if (can_use_annual_leave !== undefined) status.can_use_annual_leave = !!can_use_annual_leave;
      if (retroactive_on_promote !== undefined) status.retroactive_on_promote = !!retroactive_on_promote;
      if (isActive !== undefined) status.isActive = !!isActive;

      await status.save();
      res.json({ message: "Cập nhật thành công", data: status });
    } catch (err) {
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  remove: async (req, res) => {
    try {
      const { id } = req.params;
      const status = await EmploymentStatusModel.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { isDeleted: true },
        { new: true },
      );
      if (!status)
        return res.status(404).json({ message: "Không tìm thấy" });
      res.json({ message: "Xóa thành công" });
    } catch (err) {
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
};

module.exports = EmploymentStatusController;

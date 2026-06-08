const AttendanceMachineMappingModel = require("../models/AttendanceMachineMappingModel");
const UserInfoModel = require("../models/UserInfoModel");

const AttendanceMappingController = {
  getAll: async (req, res) => {
    try {
      const mappings = await AttendanceMachineMappingModel.find({ isDeleted: false })
        .populate("user_id", "full_name ma_nv")
        .sort({ machine_code: 1 });
      res.json({ message: "OK", data: mappings });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  create: async (req, res) => {
    try {
      const { machine_code, user_id } = req.body;
      if (!machine_code || !user_id)
        return res.status(400).json({ message: "machine_code và user_id là bắt buộc" });

      const user = await UserInfoModel.findOne({ _id: user_id, isDeleted: false });
      if (!user) return res.status(404).json({ message: "Không tìm thấy nhân viên" });

      const existing = await AttendanceMachineMappingModel.findOne({ machine_code: machine_code.trim(), isDeleted: false });
      if (existing) return res.status(409).json({ message: `machine_code "${machine_code}" đã được mapping` });

      const mapping = await AttendanceMachineMappingModel.create({ machine_code: machine_code.trim(), user_id });
      await mapping.populate("user_id", "full_name ma_nv");
      res.status(201).json({ message: "Tạo mapping thành công", data: mapping });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { machine_code, user_id } = req.body;

      const mapping = await AttendanceMachineMappingModel.findOne({ _id: id, isDeleted: false });
      if (!mapping) return res.status(404).json({ message: "Không tìm thấy mapping" });

      if (machine_code && machine_code.trim() !== mapping.machine_code) {
        const dup = await AttendanceMachineMappingModel.findOne({ machine_code: machine_code.trim(), isDeleted: false, _id: { $ne: id } });
        if (dup) return res.status(409).json({ message: `machine_code "${machine_code}" đã được mapping` });
        mapping.machine_code = machine_code.trim();
      }

      if (user_id) {
        const user = await UserInfoModel.findOne({ _id: user_id, isDeleted: false });
        if (!user) return res.status(404).json({ message: "Không tìm thấy nhân viên" });
        mapping.user_id = user_id;
      }

      await mapping.save();
      await mapping.populate("user_id", "full_name ma_nv");
      res.json({ message: "Cập nhật thành công", data: mapping });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  remove: async (req, res) => {
    try {
      const { id } = req.params;
      const mapping = await AttendanceMachineMappingModel.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { isDeleted: true },
        { new: true },
      );
      if (!mapping) return res.status(404).json({ message: "Không tìm thấy mapping" });
      res.json({ message: "Xóa mapping thành công" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
};

module.exports = AttendanceMappingController;

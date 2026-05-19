const mongoose = require("mongoose");
const BranchModel = require("../models/BranchModel");
const UserInfoModel = require("../models/UserInfoModel");

const normalizeBranchCode = (code) => String(code || "").trim().toUpperCase();
const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

const BranchController = {
  create: async (req, res) => {
    try {
      const { branch_name, branch_code, address } = req.body;
      const normalizedCode = normalizeBranchCode(branch_code);

      if (!branch_name || !normalizedCode) {
        return res.status(400).json({ message: "Tên và mã chi nhánh là bắt buộc" });
      }

      const existing = await BranchModel.findOne({ branch_code: normalizedCode });
      if (existing) {
        return res.status(409).json({ message: `Mã chi nhánh "${normalizedCode}" đã tồn tại` });
      }

      const branch = await BranchModel.create({
        branch_name: branch_name.trim(),
        branch_code: normalizedCode,
        address: address || "",
        is_active: true,
      });

      return res.status(201).json({
        message: "Tạo chi nhánh thành công",
        data: branch,
      });
    } catch (error) {
      console.error("Error in create branch:", error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  getAll: async (req, res) => {
    try {
      const branches = await BranchModel.find({ isDeleted: false }).sort({ createdAt: -1 });
      return res.status(200).json({
        message: "Lấy danh sách chi nhánh thành công",
        data: branches,
      });
    } catch (error) {
      console.error("Error in getAll branches:", error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID chi nhánh không hợp lệ" });
      }

      const branch = await BranchModel.findOne({ _id: id, isDeleted: false });
      if (!branch) {
        return res.status(404).json({ message: "Chi nhánh không tồn tại" });
      }

      const { branch_name, branch_code, address, is_active } = req.body;

      if (branch_name !== undefined) {
        if (!String(branch_name).trim()) {
          return res.status(400).json({ message: "Tên chi nhánh không được để trống" });
        }
        branch.branch_name = String(branch_name).trim();
      }

      if (branch_code !== undefined) {
        const normalizedCode = normalizeBranchCode(branch_code);
        if (!normalizedCode) {
          return res.status(400).json({ message: "Mã chi nhánh không được để trống" });
        }

        const existing = await BranchModel.findOne({
          _id: { $ne: id },
          branch_code: normalizedCode,
        });
        if (existing) {
          return res.status(409).json({ message: `Mã chi nhánh "${normalizedCode}" đã tồn tại` });
        }

        branch.branch_code = normalizedCode;
      }

      if (address !== undefined) branch.address = address || "";
      if (is_active !== undefined) branch.is_active = parseBoolean(is_active);

      await branch.save();

      return res.status(200).json({
        message: "Cập nhật chi nhánh thành công",
        data: branch,
      });
    } catch (error) {
      console.error("Error in update branch:", error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  remove: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "ID chi nhánh không hợp lệ" });
      }

      const branch = await BranchModel.findOne({ _id: id, isDeleted: false });
      if (!branch) {
        return res.status(404).json({ message: "Chi nhánh không tồn tại" });
      }

      const userCount = await UserInfoModel.countDocuments({ branch_id: id, isDeleted: false });
      if (userCount > 0) {
        return res.status(409).json({
          message: "Không thể xóa chi nhánh đang có nhân viên",
          userCount,
        });
      }

      branch.isDeleted = true;
      branch.is_active = false;
      await branch.save();

      return res.status(200).json({
        message: "Xóa chi nhánh thành công",
      });
    } catch (error) {
      console.error("Error in remove branch:", error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },
};

module.exports = BranchController;

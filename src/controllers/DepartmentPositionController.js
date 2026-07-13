const DepartmentModel = require("../models/DepartmentModel");
const { LEAF_TYPES } = require("../models/DepartmentModel");
const PositionModel = require("../models/PositionModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const UserInfoModel = require("../models/UserInfoModel");
const { ensureFolderForDept } = require("../jobs/ensureDeptFolders");

const DepartmentPositionController = {
  createDepartment: async (req, res) => {
    try {
      const {
        department_name,
        department_code,
        description,
        type,
        address,
        parent_id,
        manager_id
      } = req.body;

      if (!department_name || !department_code)
        return res.status(400).json({ message: "Tên và mã phòng ban là bắt buộc" });

      if (type && !DepartmentModel.schema.path("type").enumValues.includes(type))
        return res.status(400).json({ message: "Loại phòng ban không hợp lệ" });

      if (parent_id) {
        const parent = await DepartmentModel.findOne({ _id: parent_id, isDeleted: false });
        if (!parent) return res.status(404).json({ message: "Phòng ban cha không tồn tại" });
      }

      if (manager_id) {
        const managerInfo = await UserInfoModel.findOne({ _id: manager_id, isDeleted: false });
        if (!managerInfo) return res.status(404).json({ message: "Người quản lý không tồn tại" });
      }

      const newDept = await DepartmentModel.create({
        department_name,
        department_code,
        description: description || "",
        type: type || "department",
        address: address || "",
        parent: parent_id || null,
        manager: manager_id || null
      });

      if (LEAF_TYPES.includes(newDept.type)) {
        ensureFolderForDept(department_code);
      }

      return res.status(201).json({ message: "Tạo phòng ban thành công", data: newDept });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: "Mã phòng ban đã tồn tại" });
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  getAllDepartments: async (req, res) => {
    try {
      const { flat, leaf_only } = req.query;

      const filter = { isDeleted: false };
      if (leaf_only === "true") filter.type = { $in: LEAF_TYPES };

      const departments = await DepartmentModel.find(filter)
        .populate("parent", "department_name department_code type")
        .populate("manager", "full_name ma_nv")
        .sort({ createdAt: 1 })
        .lean();

      if (flat === "true") {
        return res
          .status(200)
          .json({ message: "Lấy danh sách phòng ban thành công", data: departments });
      }

      const nodeMap = {};
      const roots = [];

      for (const dept of departments) {
        nodeMap[dept._id.toString()] = { ...dept, children: [] };
      }

      for (const dept of departments) {
        const parentId = dept.parent?._id?.toString() || dept.parent?.toString();
        if (parentId && nodeMap[parentId]) {
          nodeMap[parentId].children.push(nodeMap[dept._id.toString()]);
        } else {
          roots.push(nodeMap[dept._id.toString()]);
        }
      }

      return res.status(200).json({ message: "Lấy danh sách phòng ban thành công", data: roots });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  updateDepartment: async (req, res) => {
    try {
      const { id } = req.params;
      const { department_name, description, type, address, parent_id, manager_id } = req.body;

      const dept = await DepartmentModel.findOne({ _id: id, isDeleted: false });
      if (!dept) return res.status(404).json({ message: "Phòng ban không tồn tại" });

      if (department_name) dept.department_name = department_name;
      if (description !== undefined) dept.description = description;
      if (address !== undefined) dept.address = address;

      if (type !== undefined) {
        if (!DepartmentModel.schema.path("type").enumValues.includes(type))
          return res.status(400).json({ message: "Loại phòng ban không hợp lệ" });
        dept.type = type;
      }

      if (parent_id !== undefined) {
        if (!parent_id) {
          dept.parent = null;
        } else {
          if (parent_id === id)
            return res.status(400).json({ message: "Phòng ban không thể là cha của chính nó" });
          const parent = await DepartmentModel.findOne({ _id: parent_id, isDeleted: false });
          if (!parent) return res.status(404).json({ message: "Phòng ban cha không tồn tại" });
          dept.parent = parent_id;
        }
      }

      if (manager_id !== undefined) {
        if (!manager_id) {
          dept.manager = null;
        } else {
          const managerInfo = await UserInfoModel.findOne({ _id: manager_id, isDeleted: false });
          if (!managerInfo) return res.status(404).json({ message: "Người quản lý không tồn tại" });
          dept.manager = manager_id;
        }
      }

      await dept.save();
      return res.status(200).json({ message: "Cập nhật phòng ban thành công", data: dept });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  deleteDepartment: async (req, res) => {
    try {
      const { id } = req.params;

      const dept = await DepartmentModel.findOne({ _id: id, isDeleted: false });
      if (!dept) return res.status(404).json({ message: "Phòng ban không tồn tại" });

      const hasChildren = await DepartmentModel.exists({ parent: id, isDeleted: false });
      if (hasChildren)
        return res.status(409).json({ message: "Không thể xóa phòng ban đang có phòng ban con" });

      const hasMember = await UserDepartmentPositionModel.exists({
        department: id,
        isDeleted: false
      });
      if (hasMember)
        return res.status(409).json({ message: "Không thể xóa phòng ban đang có nhân viên" });

      dept.isDeleted = true;
      dept.is_active = false;
      await dept.save();

      return res.status(200).json({ message: "Xóa phòng ban thành công" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  createPosition: async (req, res) => {
    try {
      const { position_name, description } = req.body;
      if (!position_name) return res.status(400).json({ message: "Tên vị trí là bắt buộc" });

      const newPosition = await PositionModel.create({ position_name, description });
      return res.status(201).json({ message: "Tạo vị trí thành công", data: newPosition });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  getAllPositions: async (_req, res) => {
    try {
      const positions = await PositionModel.find({ isDeleted: false });
      return res.status(200).json({ message: "Lấy danh sách vị trí thành công", data: positions });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  updatePosition: async (req, res) => {
    try {
      const { id } = req.params;
      const { position_name, description } = req.body;

      const position = await PositionModel.findOne({ _id: id, isDeleted: false });
      if (!position) return res.status(404).json({ message: "Chức vụ không tồn tại" });

      if (position_name) position.position_name = position_name;
      if (description !== undefined) position.description = description;

      await position.save();
      return res.status(200).json({ message: "Cập nhật chức vụ thành công", data: position });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  deletePosition: async (req, res) => {
    try {
      const { id } = req.params;

      const position = await PositionModel.findOne({ _id: id, isDeleted: false });
      if (!position) return res.status(404).json({ message: "Chức vụ không tồn tại" });

      const inUse = await UserDepartmentPositionModel.exists({ position: id, isDeleted: false });
      if (inUse)
        return res
          .status(409)
          .json({ message: "Không thể xóa chức vụ đang có nhân viên đảm nhiệm" });

      position.isDeleted = true;
      await position.save();
      return res.status(200).json({ message: "Xóa chức vụ thành công" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  }
};

module.exports = DepartmentPositionController;

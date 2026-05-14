const DepartmentModel = require("../models/DepartmentModel");
const BranchModel = require("../models/BranchModel");
const PositionModel = require("../models/PositionModel");
const { ensureFolderForDept } = require("../jobs/ensureDeptFolders");

const DepartmentPositionController = {
    // POST /department/createDepartment
    createDepartment: async (req, res) => {
        try {
            const { department_name, department_code, description, branch_id, parent_id } = req.body;

            if (!department_name || !department_code)
                return res.status(400).json({ message: "Tên và mã phòng ban là bắt buộc" });

            if (!branch_id)
                return res.status(400).json({ message: "Chi nhánh là bắt buộc" });

            const branch = await BranchModel.findOne({ _id: branch_id, isDeleted: false });
            if (!branch)
                return res.status(404).json({ message: "Chi nhánh không tồn tại" });

            if (parent_id) {
                const parent = await DepartmentModel.findOne({ _id: parent_id, isDeleted: false });
                if (!parent)
                    return res.status(404).json({ message: "Phòng ban cha không tồn tại" });
                if (parent.branch.toString() !== branch_id)
                    return res.status(400).json({ message: "Phòng ban cha phải thuộc cùng chi nhánh" });
            }

            const newDepartment = await DepartmentModel.create({
                department_name,
                department_code,
                description: description || "",
                branch: branch_id,
                parent: parent_id || null,
            });

            ensureFolderForDept(department_code);

            return res.status(201).json({
                message: "Tạo phòng ban thành công",
                data: newDepartment,
            });
        } catch (error) {
            if (error.code === 11000)
                return res.status(409).json({ message: "Mã phòng ban đã tồn tại" });
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /department/getAll?branch_id=&flat=true
    // flat=true → danh sách phẳng (dùng cho dropdown)
    // flat=false (default) → cây phân cấp theo chi nhánh
    getAllDepartments: async (req, res) => {
        try {
            const { branch_id, flat } = req.query;

            const filter = { isDeleted: false };
            if (branch_id) filter.branch = branch_id;

            const departments = await DepartmentModel.find(filter)
                .populate("branch", "branch_name branch_code")
                .populate("parent", "department_name department_code")
                .sort({ createdAt: 1 })
                .lean();

            if (flat === "true") {
                return res.status(200).json({
                    message: "Lấy danh sách phòng ban thành công",
                    data: departments,
                });
            }

            // Build tree: group by branch → root depts → children
            const branchMap = {};
            const NO_BRANCH_KEY = "__no_branch__";

            for (const dept of departments) {
                const branchId = dept.branch?._id?.toString() || NO_BRANCH_KEY;

                if (!branchMap[branchId]) {
                    branchMap[branchId] = {
                        branch: dept.branch || null,
                        departments: [],
                    };
                }

                if (!dept.parent) {
                    branchMap[branchId].departments.push({ ...dept, children: [] });
                }
            }

            // Gắn children vào parent
            for (const dept of departments) {
                if (!dept.parent) continue;
                const branchId = dept.branch?._id?.toString();
                const parentId = dept.parent?._id?.toString();
                const branchNode = branchMap[branchId];
                if (!branchNode) continue;
                const parentNode = branchNode.departments.find(
                    (d) => d._id.toString() === parentId
                );
                if (parentNode) parentNode.children.push(dept);
            }

            return res.status(200).json({
                message: "Lấy danh sách phòng ban thành công",
                data: Object.values(branchMap),
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // PUT /department/update/:id
    updateDepartment: async (req, res) => {
        try {
            const { id } = req.params;
            const { department_name, description, branch_id, parent_id } = req.body;

            const dept = await DepartmentModel.findOne({ _id: id, isDeleted: false });
            if (!dept)
                return res.status(404).json({ message: "Phòng ban không tồn tại" });

            if (department_name) dept.department_name = department_name;
            if (description !== undefined) dept.description = description;

            if (branch_id) {
                const branch = await BranchModel.findOne({ _id: branch_id, isDeleted: false });
                if (!branch)
                    return res.status(404).json({ message: "Chi nhánh không tồn tại" });
                dept.branch = branch_id;
            }

            if (parent_id !== undefined) {
                if (parent_id === null || parent_id === "") {
                    dept.parent = null;
                } else {
                    const parent = await DepartmentModel.findOne({ _id: parent_id, isDeleted: false });
                    if (!parent)
                        return res.status(404).json({ message: "Phòng ban cha không tồn tại" });
                    dept.parent = parent_id;
                }
            }

            await dept.save();
            return res.status(200).json({ message: "Cập nhật phòng ban thành công", data: dept });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    createPosition: async (req, res) => {
        try {
            const { position_name, description } = req.body;
            if (!position_name)
                return res.status(400).json({ message: "Tên vị trí là bắt buộc" });

            const newPosition = await PositionModel.create({ position_name, description });
            return res.status(201).json({
                message: "Tạo vị trí thành công",
                data: newPosition,
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    getAllPositions: async (_req, res) => {
        try {
            const positions = await PositionModel.find({ isDeleted: false });
            return res.status(200).json({
                message: "Lấy danh sách vị trí thành công",
                data: positions,
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },
};

module.exports = DepartmentPositionController;

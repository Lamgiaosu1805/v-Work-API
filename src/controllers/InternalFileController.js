const fs = require("fs");
const DepartmentModel = require("../models/DepartmentModel");
const InternalFileModel = require("../models/InternalFileModel");
const DeptFolderPermissionModel = require("../models/DeptFolderPermissionModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const AccountModel = require("../models/AccountModel");
const { getInternalFilePath } = require("../middlewares/uploadInternal");

// Lấy danh sách department IDs mà account này thuộc về
async function getUserDeptIds(accountId) {
    const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
    if (!userInfo) return [];
    const memberships = await UserDepartmentPositionModel.find({ user: userInfo._id, isDeleted: false }).select("department");
    return memberships.map((m) => m.department.toString());
}

// Kiểm tra quyền xem folder của 1 phòng ban
async function canViewDept(accountId, deptId) {
    const account = await AccountModel.findById(accountId);
    if (account?.role === "admin") return true;

    const userDeptIds = await getUserDeptIds(accountId);
    if (userDeptIds.includes(deptId.toString())) return true;

    const permission = await DeptFolderPermissionModel.findOne({ department: deptId });
    if (!permission) return false;

    if (permission.grantedUsers.some((id) => id.toString() === accountId.toString())) return true;
    if (permission.grantedDepts.some((id) => userDeptIds.includes(id.toString()))) return true;

    return false;
}

// Kiểm tra quyền upload vào folder (chỉ thành viên phòng ban hoặc admin)
async function canUploadToDept(accountId, deptId) {
    const account = await AccountModel.findById(accountId);
    if (account?.role === "admin") return true;

    const userDeptIds = await getUserDeptIds(accountId);
    return userDeptIds.includes(deptId.toString());
}

const InternalFileController = {
    // GET /internal-files/departments
    getAccessibleDepartments: async (req, res) => {
        try {
            const accountId = req.account._id;
            const account = await AccountModel.findById(accountId);
            const allDepts = await DepartmentModel.find({ isDeleted: false });

            if (account?.role === "admin") {
                return res.status(200).json({ message: "Thành công", data: allDepts });
            }

            const userDeptIds = await getUserDeptIds(accountId);
            const permissions = await DeptFolderPermissionModel.find({
                $or: [
                    { grantedUsers: accountId },
                    { grantedDepts: { $in: userDeptIds } },
                ],
            }).select("department");

            const grantedDeptIds = permissions.map((p) => p.department.toString());
            const accessibleIds = new Set([...userDeptIds, ...grantedDeptIds]);

            const data = allDepts.filter((d) => accessibleIds.has(d._id.toString()));
            return res.status(200).json({ message: "Thành công", data });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /internal-files/:deptId/files
    getFilesByDept: async (req, res) => {
        try {
            const { deptId } = req.params;
            const accountId = req.account._id;

            if (!(await canViewDept(accountId, deptId))) {
                return res.status(403).json({ message: "Bạn không có quyền xem folder này" });
            }

            const files = await InternalFileModel.find({ department: deptId, isDeleted: false })
                .populate("uploadedBy", "username")
                .sort({ createdAt: -1 });

            return res.status(200).json({ message: "Thành công", data: files });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /internal-files/:deptId/upload
    uploadFile: async (req, res) => {
        try {
            const { deptId } = req.params;
            const accountId = req.account._id;

            if (!(await canUploadToDept(accountId, deptId))) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(403).json({ message: "Bạn không có quyền upload vào folder này" });
            }

            if (!req.file) {
                return res.status(400).json({ message: "Không có file được gửi lên" });
            }

            const newFile = new InternalFileModel({
                originalName: req.file.originalname,
                filename: req.file.filename,
                departmentCode: req._deptCode,
                subfolder: req.subfolder || "",
                category: "general",
                mimeType: req.file.mimetype,
                size: req.file.size,
                uploadedBy: accountId,
                department: deptId,
            });

            await newFile.save();
            return res.status(201).json({ message: "Upload thành công", data: newFile });
        } catch (error) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /internal-files/file/:fileId/view
    viewFile: async (req, res) => {
        try {
            const { fileId } = req.params;
            const accountId = req.account._id;

            const file = await InternalFileModel.findOne({ _id: fileId, isDeleted: false });
            if (!file) return res.status(404).json({ message: "Không tìm thấy file" });

            if (!(await canViewDept(accountId, file.department))) {
                return res.status(403).json({ message: "Bạn không có quyền xem file này" });
            }

            const filePath = getInternalFilePath(file.departmentCode, file.subfolder, file.filename);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: "File không tồn tại trên server" });
            }

            res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
            return res.sendFile(filePath);
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /internal-files/:deptId/grant  (admin only)
    grantAccess: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { grantedUsers = [], grantedDepts = [] } = req.body;

            const dept = await DepartmentModel.findOne({ _id: deptId, isDeleted: false });
            if (!dept) return res.status(404).json({ message: "Phòng ban không tồn tại" });

            const permission = await DeptFolderPermissionModel.findOneAndUpdate(
                { department: deptId },
                {
                    $addToSet: {
                        grantedUsers: { $each: grantedUsers },
                        grantedDepts: { $each: grantedDepts },
                    },
                },
                { upsert: true, new: true }
            );

            return res.status(200).json({ message: "Cấp quyền thành công", data: permission });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /internal-files/:deptId/revoke  (admin only)
    revokeAccess: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { grantedUsers = [], grantedDepts = [] } = req.body;

            const permission = await DeptFolderPermissionModel.findOneAndUpdate(
                { department: deptId },
                { $pullAll: { grantedUsers, grantedDepts } },
                { new: true }
            );

            return res.status(200).json({ message: "Thu hồi quyền thành công", data: permission });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /internal-files/:deptId/permissions  (admin only)
    getPermissions: async (req, res) => {
        try {
            const { deptId } = req.params;
            const permission = await DeptFolderPermissionModel.findOne({ department: deptId })
                .populate("grantedUsers", "username")
                .populate("grantedDepts", "department_name department_code");

            return res.status(200).json({ message: "Thành công", data: permission || { grantedUsers: [], grantedDepts: [] } });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // DELETE /internal-files/file/:fileId  (admin hoặc người upload)
    deleteFile: async (req, res) => {
        try {
            const { fileId } = req.params;
            const accountId = req.account._id;
            const account = await AccountModel.findById(accountId);

            const file = await InternalFileModel.findOne({ _id: fileId, isDeleted: false });
            if (!file) return res.status(404).json({ message: "Không tìm thấy file" });

            const isOwner = file.uploadedBy.toString() === accountId.toString();
            if (account?.role !== "admin" && !isOwner) {
                return res.status(403).json({ message: "Bạn không có quyền xóa file này" });
            }

            file.isDeleted = true;
            await file.save();

            const filePath = getInternalFilePath(file.departmentCode, file.subfolder, file.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

            return res.status(200).json({ message: "Xóa file thành công" });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },
};

module.exports = { InternalFileController, getUserDeptIds, canViewDept };

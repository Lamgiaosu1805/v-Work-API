const fs = require("fs");
const DepartmentModel = require("../models/DepartmentModel");
const InternalFileModel = require("../models/InternalFileModel");
const InternalFolderModel = require("../models/InternalFolderModel");
const DeptFolderPermissionModel = require("../models/DeptFolderPermissionModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const AccountModel = require("../models/AccountModel");
const { getInternalFilePath } = require("../middlewares/uploadInternal");

async function getFullNameMap(accountIds) {
    const ids = accountIds.filter(Boolean);
    if (!ids.length) return {};
    const infos = await UserInfoModel.find({ id_account: { $in: ids }, isDeleted: false }).select("id_account full_name");
    return Object.fromEntries(infos.map((u) => [u.id_account.toString(), u.full_name]));
}

async function getUserDeptIds(accountId) {
    const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
    if (!userInfo) return [];
    const memberships = await UserDepartmentPositionModel.find({ user: userInfo._id, isDeleted: false }).select("department");
    return memberships.map((m) => m.department.toString());
}

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

async function canUploadToDept(accountId, deptId) {
    const account = await AccountModel.findById(accountId);
    if (account?.role === "admin") return true;

    const userDeptIds = await getUserDeptIds(accountId);
    return userDeptIds.includes(deptId.toString());
}

// BFS để collect tất cả folder IDs kể cả chính nó
async function getAllDescendantFolderIds(folderId) {
    const result = [];
    const queue = [folderId.toString()];
    while (queue.length > 0) {
        const currentId = queue.shift();
        result.push(currentId);
        const children = await InternalFolderModel.find({ parent_id: currentId, isDeleted: false }).select("_id");
        queue.push(...children.map((c) => c._id.toString()));
    }
    return result;
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

    // GET /internal-files/:deptId/folders?parent_id=xxx
    getFolders: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { parent_id } = req.query;
            const accountId = req.account._id;

            if (!(await canViewDept(accountId, deptId))) {
                return res.status(403).json({ message: "Bạn không có quyền xem thư mục này" });
            }

            // "null" string hoặc undefined → root (parent_id = null)
            const parentId = parent_id && parent_id !== "null" ? parent_id : null;

            const folders = await InternalFolderModel.find({
                department: deptId,
                parent_id: parentId,
                isDeleted: false,
            })
                .populate("createdBy", "username")
                .sort({ name: 1 });

            const fullNameMap = await getFullNameMap(folders.map((f) => f.createdBy?._id));
            const data = folders.map((f) => {
                const obj = f.toJSON();
                if (obj.createdBy) obj.createdBy.full_name = fullNameMap[obj.createdBy._id?.toString()] || null;
                return obj;
            });

            return res.status(200).json({ message: "Thành công", data });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /internal-files/:deptId/folders
    createFolder: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { name, parent_id } = req.body;
            const accountId = req.account._id;

            if (!name?.trim()) {
                return res.status(400).json({ message: "Tên thư mục không được để trống" });
            }

            if (!(await canUploadToDept(accountId, deptId))) {
                return res.status(403).json({ message: "Bạn không có quyền tạo thư mục" });
            }

            const dept = await DepartmentModel.findOne({ _id: deptId, isDeleted: false });
            if (!dept) return res.status(404).json({ message: "Phòng ban không tồn tại" });

            if (parent_id) {
                const parentFolder = await InternalFolderModel.findOne({ _id: parent_id, department: deptId, isDeleted: false });
                if (!parentFolder) return res.status(404).json({ message: "Thư mục cha không tồn tại" });
            }

            const duplicate = await InternalFolderModel.findOne({
                department: deptId,
                parent_id: parent_id || null,
                name: name.trim(),
                isDeleted: false,
            });
            if (duplicate) return res.status(409).json({ message: "Đã có thư mục cùng tên tại vị trí này" });

            const folder = await InternalFolderModel.create({
                name: name.trim(),
                department: deptId,
                departmentCode: dept.department_code,
                parent_id: parent_id || null,
                createdBy: accountId,
            });

            return res.status(201).json({ message: "Tạo thư mục thành công", data: folder });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // DELETE /internal-files/:deptId/folders/:folderId
    deleteFolder: async (req, res) => {
        try {
            const { deptId, folderId } = req.params;
            const accountId = req.account._id;
            const account = await AccountModel.findById(accountId);

            const folder = await InternalFolderModel.findOne({ _id: folderId, department: deptId, isDeleted: false });
            if (!folder) return res.status(404).json({ message: "Không tìm thấy thư mục" });

            const isCreator = folder.createdBy.toString() === accountId.toString();
            const isAdminOrMgr = account?.role === "admin" ||
                (account?.role === "manager" && account?.module_access?.includes("workplace"));
            if (!isAdminOrMgr && !isCreator) {
                return res.status(403).json({ message: "Bạn không có quyền xóa thư mục này" });
            }

            const now = new Date();
            const allFolderIds = await getAllDescendantFolderIds(folderId);

            // Tìm file trước khi xóa để xóa trên disk
            const filesToDelete = await InternalFileModel.find({
                folder_id: { $in: allFolderIds },
                isDeleted: false,
            }).select("departmentCode subfolder filename");

            // Soft-delete files
            await InternalFileModel.updateMany(
                { folder_id: { $in: allFolderIds }, isDeleted: false },
                { $set: { isDeleted: true, deletedBy: accountId, deletedAt: now } }
            );

            // Xóa file trên disk
            for (const file of filesToDelete) {
                const filePath = getInternalFilePath(file.departmentCode, file.subfolder, file.filename);
                if (fs.existsSync(filePath)) {
                    try { fs.unlinkSync(filePath); } catch (_) {}
                }
            }

            // Soft-delete tất cả thư mục (cả con cháu)
            await InternalFolderModel.updateMany(
                { _id: { $in: allFolderIds }, isDeleted: false },
                { $set: { isDeleted: true, deletedBy: accountId, deletedAt: now } }
            );

            return res.status(200).json({
                message: "Đã xóa thư mục",
                data: {
                    deleted_folders: allFolderIds.length,
                    deleted_files: filesToDelete.length,
                    deleted_by: accountId,
                    deleted_at: now,
                },
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /internal-files/:deptId/files?folder_id=xxx
    getFilesByDept: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { folder_id } = req.query;
            const accountId = req.account._id;

            if (!(await canViewDept(accountId, deptId))) {
                return res.status(403).json({ message: "Bạn không có quyền xem folder này" });
            }

            // folder_id có giá trị → lọc theo folder đó
            // folder_id không có / "null" → chỉ lấy file ở root (folder_id null hoặc không set)
            const folderFilter = folder_id && folder_id !== "null"
                ? { folder_id }
                : { folder_id: { $in: [null] } };

            const files = await InternalFileModel.find({ department: deptId, isDeleted: false, ...folderFilter })
                .populate("uploadedBy", "username")
                .sort({ createdAt: -1 });

            const fullNameMap = await getFullNameMap(files.map((f) => f.uploadedBy?._id));
            const data = files.map((f) => {
                const obj = f.toJSON();
                if (obj.uploadedBy) obj.uploadedBy.full_name = fullNameMap[obj.uploadedBy._id?.toString()] || null;
                return obj;
            });

            return res.status(200).json({ message: "Thành công", data });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /internal-files/:deptId/upload  (nhiều file)
    uploadFile: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { folder_id } = req.body;
            const accountId = req.account._id;

            const cleanup = () => {
                if (req.files) req.files.forEach((f) => { try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) {} });
            };

            if (!(await canUploadToDept(accountId, deptId))) {
                cleanup();
                return res.status(403).json({ message: "Bạn không có quyền upload vào folder này" });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: "Không có file được gửi lên" });
            }

            if (folder_id) {
                const folder = await InternalFolderModel.findOne({ _id: folder_id, department: deptId, isDeleted: false });
                if (!folder) {
                    cleanup();
                    return res.status(404).json({ message: "Thư mục không tồn tại" });
                }
            }

            const savedFiles = await Promise.all(
                req.files.map((file) =>
                    InternalFileModel.create({
                        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
                        filename: file.filename,
                        departmentCode: req._deptCode,
                        subfolder: req.subfolder || "",
                        folder_id: folder_id || null,
                        category: "general",
                        mimeType: file.mimetype,
                        size: file.size,
                        uploadedBy: accountId,
                        department: deptId,
                    })
                )
            );

            return res.status(201).json({ message: `Đã tải lên ${savedFiles.length} file`, data: savedFiles });
        } catch (error) {
            if (req.files) req.files.forEach((f) => { try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) {} });
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
            res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
            return res.sendFile(filePath);
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // DELETE /internal-files/file/:fileId
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
            file.deletedBy = accountId;
            file.deletedAt = new Date();
            await file.save();

            const filePath = getInternalFilePath(file.departmentCode, file.subfolder, file.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

            return res.status(200).json({ message: "Xóa file thành công" });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /internal-files/:deptId/folders/all — trả toàn bộ folder (để build tree cho MoveDialog)
    getAllFolders: async (req, res) => {
        try {
            const { deptId } = req.params;
            const accountId = req.account._id;

            if (!(await canViewDept(accountId, deptId))) {
                return res.status(403).json({ message: "Bạn không có quyền xem thư mục này" });
            }

            const folders = await InternalFolderModel.find({ department: deptId, isDeleted: false })
                .select("_id name parent_id")
                .sort({ name: 1 });

            return res.status(200).json({ message: "Thành công", data: folders });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // PATCH /internal-files/file/:fileId/rename
    renameFile: async (req, res) => {
        try {
            const { fileId } = req.params;
            const { name } = req.body;
            const accountId = req.account._id;
            const account = await AccountModel.findById(accountId);

            if (!name?.trim()) return res.status(400).json({ message: "Tên file không được để trống" });

            const file = await InternalFileModel.findOne({ _id: fileId, isDeleted: false });
            if (!file) return res.status(404).json({ message: "Không tìm thấy file" });

            const isOwner = file.uploadedBy.toString() === accountId.toString();
            if (account?.role !== "admin" && !isOwner) {
                return res.status(403).json({ message: "Bạn không có quyền đổi tên file này" });
            }

            file.originalName = name.trim();
            await file.save();

            return res.status(200).json({ message: "Đổi tên thành công", data: file });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // PATCH /internal-files/file/:fileId/move
    moveFile: async (req, res) => {
        try {
            const { fileId } = req.params;
            const { folder_id } = req.body;
            const accountId = req.account._id;

            const file = await InternalFileModel.findOne({ _id: fileId, isDeleted: false });
            if (!file) return res.status(404).json({ message: "Không tìm thấy file" });

            if (!(await canUploadToDept(accountId, file.department))) {
                return res.status(403).json({ message: "Bạn không có quyền di chuyển file này" });
            }

            if (folder_id) {
                const folder = await InternalFolderModel.findOne({ _id: folder_id, department: file.department, isDeleted: false });
                if (!folder) return res.status(404).json({ message: "Thư mục đích không tồn tại" });
            }

            file.folder_id = folder_id || null;
            await file.save();

            return res.status(200).json({ message: "Di chuyển file thành công", data: file });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // PATCH /internal-files/:deptId/folders/:folderId/rename
    renameFolder: async (req, res) => {
        try {
            const { deptId, folderId } = req.params;
            const { name } = req.body;
            const accountId = req.account._id;
            const account = await AccountModel.findById(accountId);

            if (!name?.trim()) return res.status(400).json({ message: "Tên thư mục không được để trống" });

            const folder = await InternalFolderModel.findOne({ _id: folderId, department: deptId, isDeleted: false });
            if (!folder) return res.status(404).json({ message: "Không tìm thấy thư mục" });

            const isCreator = folder.createdBy.toString() === accountId.toString();
            const isAdminOrMgr = account?.role === "admin" || (account?.role === "manager" && account?.module_access?.includes("workplace"));
            if (!isAdminOrMgr && !isCreator) {
                return res.status(403).json({ message: "Bạn không có quyền đổi tên thư mục này" });
            }

            const duplicate = await InternalFolderModel.findOne({
                department: deptId,
                parent_id: folder.parent_id ?? null,
                name: name.trim(),
                isDeleted: false,
                _id: { $ne: folderId },
            });
            if (duplicate) return res.status(409).json({ message: "Đã có thư mục cùng tên tại vị trí này" });

            folder.name = name.trim();
            await folder.save();

            return res.status(200).json({ message: "Đổi tên thành công", data: folder });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // PATCH /internal-files/:deptId/folders/:folderId/move
    moveFolder: async (req, res) => {
        try {
            const { deptId, folderId } = req.params;
            const { parent_id } = req.body;
            const accountId = req.account._id;
            const account = await AccountModel.findById(accountId);

            const folder = await InternalFolderModel.findOne({ _id: folderId, department: deptId, isDeleted: false });
            if (!folder) return res.status(404).json({ message: "Không tìm thấy thư mục" });

            const isCreator = folder.createdBy.toString() === accountId.toString();
            const isAdminOrMgr = account?.role === "admin" || (account?.role === "manager" && account?.module_access?.includes("workplace"));
            if (!isAdminOrMgr && !isCreator) {
                return res.status(403).json({ message: "Bạn không có quyền di chuyển thư mục này" });
            }

            if (parent_id) {
                const allDescendants = await getAllDescendantFolderIds(folderId);
                if (allDescendants.includes(parent_id.toString())) {
                    return res.status(400).json({ message: "Không thể di chuyển thư mục vào chính nó hoặc thư mục con" });
                }
                const targetFolder = await InternalFolderModel.findOne({ _id: parent_id, department: deptId, isDeleted: false });
                if (!targetFolder) return res.status(404).json({ message: "Thư mục đích không tồn tại" });
            }

            const duplicate = await InternalFolderModel.findOne({
                department: deptId,
                parent_id: parent_id || null,
                name: folder.name,
                isDeleted: false,
                _id: { $ne: folderId },
            });
            if (duplicate) return res.status(409).json({ message: "Đã có thư mục cùng tên tại vị trí đích" });

            folder.parent_id = parent_id || null;
            await folder.save();

            return res.status(200).json({ message: "Di chuyển thư mục thành công", data: folder });
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

    // POST /internal-files/:deptId/grant  (admin only)
    grantAccess: async (req, res) => {
        try {
            const { deptId } = req.params;
            const { grantedUsers = [], grantedDepts = [] } = req.body;

            const dept = await DepartmentModel.findOne({ _id: deptId, isDeleted: false });
            if (!dept) return res.status(404).json({ message: "Phòng ban không tồn tại" });

            const permission = await DeptFolderPermissionModel.findOneAndUpdate(
                { department: deptId },
                { $addToSet: { grantedUsers: { $each: grantedUsers }, grantedDepts: { $each: grantedDepts } } },
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
};

module.exports = { InternalFileController, getUserDeptIds, canViewDept, getFullNameMap };

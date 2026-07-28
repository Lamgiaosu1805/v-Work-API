const fs = require("fs");
const SharedFolderModel = require("../models/SharedFolderModel");
const SharedFileModel = require("../models/SharedFileModel");
const { getSharedFilePath } = require("../middlewares/uploadShared");
const { getFullNameMap } = require("../controllers/InternalFileController");
const {
  buildVisibilityFilter,
  canDoFolderAction,
  getAllDescendantSharedFolderIds
} = require("../helpers/shareFolderHelper");
const UserInfoModel = require("../models/UserInfoModel");
const DepartmentModel = require("../models/DepartmentModel");

function safeUnlink(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`Không thể xóa file trên disk: ${filePath}`, err.message);
  }
}

const SharedFolderService = {
  async getFolders(accountId, parentId) {
    const visibilityFilter = await buildVisibilityFilter(accountId);

    const folders = await SharedFolderModel.find({
      parent_id: parentId,
      isDeleted: false,
      ...visibilityFilter
    })
      .populate("createdBy", "username")
      .sort({ name: 1 });

    const fullNameMap = await getFullNameMap(folders.map((f) => f.createdBy?._id));
    return folders.map((f) => {
      const obj = f.toJSON();
      if (obj.createdBy)
        obj.createdBy.full_name = fullNameMap[obj.createdBy._id?.toString()] || null;
      return obj;
    });
  },

  async getAllFolders() {
    return SharedFolderModel.find({ isDeleted: false })
      .select("_id name parent_id")
      .sort({ name: 1 });
  },

  async createFolder(
    accountId,
    { name, description, parent_id, scope, visibleDepartments, defaultActions }
  ) {
    if (!name?.trim()) {
      return { error: { status: 400, message: "Tên thư mục không được để trống" } };
    }

    if (parent_id) {
      const parentFolder = await SharedFolderModel.findOne({ _id: parent_id, isDeleted: false });
      if (!parentFolder) return { error: { status: 404, message: "Thư mục cha không tồn tại" } };
    }

    const duplicate = await SharedFolderModel.findOne({
      parent_id: parent_id || null,
      name: name.trim(),
      isDeleted: false
    });
    if (duplicate)
      return { error: { status: 409, message: "Đã có thư mục cùng tên tại vị trí này" } };

    const folder = await SharedFolderModel.create({
      name: name.trim(),
      description: description?.trim() || null,
      parent_id: parent_id || null,
      scope: scope || "all_departments",
      visibleDepartments: visibleDepartments || [],
      defaultActions: defaultActions || ["view"],
      createdBy: accountId
    });

    return { data: folder };
  },

  async renameFolder(accountId, folderId, name) {
    if (!name?.trim())
      return { error: { status: 400, message: "Tên thư mục không được để trống" } };

    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    if (!(await canDoFolderAction(accountId, folder, "manage"))) {
      return { error: { status: 403, message: "Bạn không có quyền đổi tên thư mục này" } };
    }

    const duplicate = await SharedFolderModel.findOne({
      parent_id: folder.parent_id ?? null,
      name: name.trim(),
      isDeleted: false,
      _id: { $ne: folderId }
    });
    if (duplicate)
      return { error: { status: 409, message: "Đã có thư mục cùng tên tại vị trí này" } };

    folder.name = name.trim();
    await folder.save();

    return { data: folder };
  },

  async moveFolder(accountId, folderId, parentId) {
    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    if (!(await canDoFolderAction(accountId, folder, "manage"))) {
      return { error: { status: 403, message: "Bạn không có quyền di chuyển thư mục này" } };
    }

    if (parentId) {
      const allDescendants = await getAllDescendantSharedFolderIds(folderId);
      if (allDescendants.includes(parentId.toString())) {
        return {
          error: {
            status: 400,
            message: "Không thể di chuyển thư mục vào chính nó hoặc thư mục con"
          }
        };
      }

      const targetFolder = await SharedFolderModel.findOne({ _id: parentId, isDeleted: false });
      if (!targetFolder) return { error: { status: 404, message: "Thư mục đích không tồn tại" } };

      if (!(await canDoFolderAction(accountId, targetFolder, "upload"))) {
        return {
          error: { status: 403, message: "Bạn không có quyền di chuyển thư mục vào đích này" }
        };
      }
    }

    const duplicate = await SharedFolderModel.findOne({
      parent_id: parentId || null,
      name: folder.name,
      isDeleted: false,
      _id: { $ne: folderId }
    });
    if (duplicate)
      return { error: { status: 409, message: "Đã có thư mục cùng tên tại vị trí đích" } };

    folder.parent_id = parentId || null;
    await folder.save();

    return { data: folder };
  },

  async deleteFolder(accountId, folderId) {
    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    if (!(await canDoFolderAction(accountId, folder, "manage"))) {
      return { error: { status: 403, message: "Bạn không có quyền xóa thư mục này" } };
    }

    const now = new Date();
    const allFolderIds = await getAllDescendantSharedFolderIds(folderId);

    const filesToDelete = await SharedFileModel.find({
      folder_id: { $in: allFolderIds },
      isDeleted: false
    }).select("filename folder_id");

    await SharedFileModel.updateMany(
      { folder_id: { $in: allFolderIds }, isDeleted: false },
      { $set: { isDeleted: true, deletedBy: accountId, deletedAt: now } }
    );

    filesToDelete.forEach((file) => safeUnlink(getSharedFilePath(file.folder_id, file.filename)));

    await SharedFolderModel.updateMany(
      { _id: { $in: allFolderIds }, isDeleted: false },
      { $set: { isDeleted: true, deletedBy: accountId, deletedAt: now } }
    );

    return {
      data: {
        deleted_folders: allFolderIds.length,
        deleted_files: filesToDelete.length,
        deleted_by: accountId,
        deleted_at: now
      }
    };
  },

  async getPermissions(folderId) {
    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    const { permissions } = folder.toObject();

    const userAccountIds = permissions
      .filter((p) => p.subjectType === "user")
      .map((p) => p.subjectId)
      .filter(Boolean);

    const deptIds = permissions
      .filter((p) => p.subjectType === "department")
      .map((p) => p.subjectId)
      .filter(Boolean);

    const [userInfos, departments] = await Promise.all([
      userAccountIds.length
        ? UserInfoModel.find({ id_account: { $in: userAccountIds }, isDeleted: false }).select(
            "id_account full_name ma_nv"
          )
        : [],
      deptIds.length
        ? DepartmentModel.find({ _id: { $in: deptIds }, isDeleted: false }).select(
            "department_name department_code"
          )
        : []
    ]);

    const userInfoMap = Object.fromEntries(
      userInfos.map((u) => [u.id_account.toString(), { full_name: u.full_name, ma_nv: u.ma_nv }])
    );
    const deptMap = Object.fromEntries(
      departments.map((d) => [
        d._id.toString(),
        { department_name: d.department_name, department_code: d.department_code }
      ])
    );

    const data = permissions.map((p) => {
      const idStr = p.subjectId?.toString();

      if (p.subjectType === "user") {
        const info = userInfoMap[idStr];
        return {
          ...p,
          subjectId: {
            _id: idStr,
            full_name: info?.full_name ?? null,
            ma_nv: info?.ma_nv ?? null
          }
        };
      }

      if (p.subjectType === "department") {
        const dept = deptMap[idStr];
        return {
          ...p,
          subjectId: {
            _id: idStr,
            department_name: dept?.department_name ?? null,
            department_code: dept?.department_code ?? null
          }
        };
      }

      return p;
    });

    return { data };
  },

  async updatePermissions(folderId, permissions, defaultActions) {
    if (!Array.isArray(permissions)) {
      return { error: { status: 400, message: "permissions phải là mảng" } };
    }

    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    let normalizedPermissions;
    try {
      normalizedPermissions = permissions.map((p) => ({
        subjectType: p.subjectType,
        refModel: p.refModel,
        subjectId: p.subjectId,
        actions: p.actions
      }));
    } catch (err) {
      return { error: { status: 400, message: err.message } };
    }

    folder.permissions = normalizedPermissions;
    if (defaultActions !== undefined) folder.defaultActions = defaultActions;
    await folder.save();

    return { data: folder };
  }
};

module.exports = { SharedFolderService, safeUnlink };

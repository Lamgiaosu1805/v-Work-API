const fsPromises = require("fs/promises");
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
const {
  getRootFolderId,
  createAuditLog,
  mappingMessageAuditLog,
  getUserAuditProfileMap
} = require("../helpers/sharedFolderAuditLogHelper");
const { TARGET_TYPES, AUDIT_ACTION } = require("../models/SharedFolderAuditLogModel");
const SharedFolderAuditLogModel = require("../models/SharedFolderAuditLogModel");

async function safeUnlink(filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`Không thể xóa file trên disk: ${filePath}`, err.message);
    }
  }
}

async function deleteFolderCascade(accountId, folderId) {
  const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
  if (!folder) return { error: { status: 404, message: `Không tìm thấy thư mục (${folderId})` } };

  if (!(await canDoFolderAction(accountId, folder, "delete_file"))) {
    return {
      error: { status: 403, message: `Bạn không có quyền xóa thư mục "${folder.name}"` }
    };
  }

  const rootFolderId = await getRootFolderId(folder._id, folder._id);

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

  await Promise.all(
    filesToDelete.map((file) => safeUnlink(getSharedFilePath(file.folder_id, file.filename)))
  );

  await SharedFolderModel.updateMany(
    { _id: { $in: allFolderIds }, isDeleted: false },
    { $set: { isDeleted: true, deletedBy: accountId, deletedAt: now } }
  );

  await createAuditLog({
    rootFolderId,
    folderId: folder._id,
    targetType: TARGET_TYPES.FOLDER,
    targetId: folder._id,
    action: AUDIT_ACTION.DELETE_FOLDER,
    performedBy: accountId,
    targetName: folder.name,
    message: mappingMessageAuditLog.DELETE_FOLDER(folder.name)
  });

  return {
    data: {
      folderId: folder._id,
      folderName: folder.name,
      deleted_folders: allFolderIds.length,
      deleted_files: filesToDelete.length,
      deleted_folder_ids: allFolderIds.map(String)
    }
  };
}

const SharedFolderService = {
  async getFolders(accountId, parentId, search) {
    const searchNameFolder = search.trim();
    const visibilityFilter = await buildVisibilityFilter(accountId);

    const folders = await SharedFolderModel.find({
      parent_id: parentId,
      name: { $regex: searchNameFolder, $options: "i" },
      isDeleted: false,
      ...visibilityFilter
    })
      .populate("createdBy", "username")
      .sort({ name: 1 });

    const fullNameMap = await getFullNameMap(folders.map((f) => f.createdBy?._id));

    // if (parentId) {
    //   const openedFolder = await SharedFolderModel.findOne({
    //     _id: parentId,
    //     isDeleted: false
    //   }).select("name parent_id");

    //   if (openedFolder) {
    //     const rootFolderId = await getRootFolderId(openedFolder._id);
    //     createAuditLog({
    //       rootFolderId,
    //       folderId: openedFolder._id,
    //       targetType: TARGET_TYPES.FOLDER,
    //       targetId: openedFolder._id,
    //       action: AUDIT_ACTION.VIEW_FOLDER,
    //       performedBy: accountId,
    //       targetName: openedFolder.name,
    //       message: mappingMessageAuditLog.VIEW_FOLDER(openedFolder.name)
    //     }).catch((err) =>
    //       console.error(`Ghi audit log VIEW_FOLDER thất bại (folderId=${parentId}):`, err)
    //     );
    //   }
    // }

    return folders.map((f) => {
      const obj = f.toJSON();
      if (obj.createdBy)
        obj.createdBy.full_name = fullNameMap[obj.createdBy._id?.toString()] || null;
      return obj;
    });
  },

  async getAllFolders() {
    return SharedFolderModel.find({ isDeleted: false })
      .select("_id name parent_id autoCleanup autoCleanupDays defaultActions")
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

    const rootFolderId = await getRootFolderId(folder._id);

    await createAuditLog({
      rootFolderId,
      folderId: folder._id,
      targetType: TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: AUDIT_ACTION.CREATE_FOLDER,
      performedBy: accountId,
      targetName: folder.name,
      message: mappingMessageAuditLog.CREATE_FOLDER(folder.name)
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

    const oldName = folder.name;
    const newName = name.trim();

    const rootFolderId = await getRootFolderId(folder._id);

    folder.name = newName;
    await folder.save();

    await createAuditLog({
      rootFolderId,
      folderId: folder._id,
      targetType: TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: AUDIT_ACTION.RENAME_FOLDER,
      performedBy: accountId,
      targetName: newName,
      message: mappingMessageAuditLog.RENAME_FOLDER(oldName, newName)
    });

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

    const oldParentId = folder.parent_id || null;

    const oldParentFolder = oldParentId
      ? await SharedFolderModel.findOne({
          _id: oldParentId,
          isDeleted: false
        }).select("name")
      : null;

    const newParentFolder = parentId
      ? await SharedFolderModel.findOne({
          _id: parentId,
          isDeleted: false
        }).select("name")
      : null;

    const oldParentName = oldParentFolder?.name || "Thư mục gốc";
    const newParentName = newParentFolder?.name || "Thư mục gốc";

    folder.parent_id = parentId || null;
    await folder.save();

    const rootFolderId = await getRootFolderId(folder._id);

    await createAuditLog({
      rootFolderId,
      folderId: folder._id,
      targetType: TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: AUDIT_ACTION.MOVE_FOLDER,
      performedBy: accountId,
      targetName: folder.name,
      message: mappingMessageAuditLog.MOVE_FOLDER(folder.name, oldParentName, newParentName)
    });
    return { data: folder };
  },

  async deleteFolder(accountId, folderId) {
    const result = await deleteFolderCascade(accountId, folderId);
    if (result.error) return result;

    return {
      data: {
        deleted_folders: result.data.deleted_folders,
        deleted_files: result.data.deleted_files,
        deleted_by: accountId,
        deleted_at: new Date()
      }
    };
  },

  async deleteFolders(accountId, folderIds) {
    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      return { error: { status: 400, message: "folderIds phải là mảng và không được rỗng" } };
    }

    const results = [];
    const errors = [];
    const allDeletedFolderIds = [];
    let totalDeletedFolders = 0;
    let totalDeletedFiles = 0;

    for (const folderId of folderIds) {
      const stillExists = await SharedFolderModel.exists({ _id: folderId, isDeleted: false });
      if (!stillExists) continue;

      const result = await deleteFolderCascade(accountId, folderId);
      if (result.error) {
        errors.push({ folderId, message: result.error.message });
        continue;
      }

      totalDeletedFolders += result.data.deleted_folders;
      totalDeletedFiles += result.data.deleted_files;
      allDeletedFolderIds.push(...result.data.deleted_folder_ids);
      results.push(result.data);
    }

    return {
      data: {
        deleted_folders: totalDeletedFolders,
        deleted_files: totalDeletedFiles,
        deleted_folder_list: results,
        deleted_folder_ids: allDeletedFolderIds,
        errors,
        deleted_by: accountId,
        deleted_at: new Date()
      }
    };
  },

  async deleteMultiple(accountId, { folderIds = [], fileIds = [] } = {}) {
    // eslint-disable-next-line global-require
    const { SharedFileService } = require("./sharedFileService");

    const safeFolderIds = Array.isArray(folderIds) ? folderIds : [];
    const safeFileIds = Array.isArray(fileIds) ? fileIds : [];

    if (!safeFolderIds.length && !safeFileIds.length) {
      return { error: { status: 400, message: "Cần chọn ít nhất 1 thư mục hoặc file để xóa" } };
    }

    let folderResult = {
      deleted_folders: 0,
      deleted_files: 0,
      deleted_folder_ids: [],
      errors: []
    };

    if (safeFolderIds.length) {
      const result = await this.deleteFolders(accountId, safeFolderIds);
      if (result.error) return result;
      folderResult = result.data;
    }

    let remainingFileIds = safeFileIds;
    const deletedFolderIdSet = new Set(folderResult.deleted_folder_ids);

    if (deletedFolderIdSet.size && safeFileIds.length) {
      const filesInfo = await SharedFileModel.find({ _id: { $in: safeFileIds } }).select(
        "folder_id"
      );
      const skippedIds = new Set(
        filesInfo
          .filter((f) => f.folder_id && deletedFolderIdSet.has(f.folder_id.toString()))
          .map((f) => f._id.toString())
      );
      remainingFileIds = safeFileIds.filter((id) => !skippedIds.has(id.toString()));
    }

    let fileResult = { success: [], failed: [], deleted: 0, failedCount: 0 };
    if (remainingFileIds.length) {
      const result = await SharedFileService.deleteFile(accountId, remainingFileIds);
      if (!result.error) fileResult = result.data;
    }

    return {
      data: {
        deleted_folders: folderResult.deleted_folders,
        deleted_files_in_folders: folderResult.deleted_files,
        deleted_files: fileResult.deleted,
        failed_files: fileResult.failed,
        folder_errors: folderResult.errors,
        deleted_by: accountId,
        deleted_at: new Date()
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

  async updatePermissions(accountId, folderId, permissions, defaultActions) {
    if (!Array.isArray(permissions)) {
      return { error: { status: 400, message: "permissions phải là mảng" } };
    }

    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    if (folder.parent_id) {
      return {
        error: {
          status: 400,
          message: "Chỉ thư mục gốc mới được cấu hình tự động dọn dẹp"
        }
      };
    }

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

    const rootFolderId = await getRootFolderId(folder._id);

    await createAuditLog({
      rootFolderId,
      folderId: folder._id,
      targetType: TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: AUDIT_ACTION.UPDATE_PERMISSIONS,
      performedBy: accountId,
      targetName: folder.name,
      message: mappingMessageAuditLog.UPDATE_PERMISSIONS(folder.name)
    });

    return { data: folder };
  },

  async updateDefaultActions(accountId, folderId, defaultActions) {
    if (!Array.isArray(defaultActions) || !defaultActions.length) {
      return { error: { status: 400, message: "defaultActions phải là mảng và không được rỗng" } };
    }

    const invalid = defaultActions.filter(
      (a) => !SharedFolderModel.FOLDER_ACTION_VALUES.includes(a)
    );
    if (invalid.length) {
      return { error: { status: 400, message: `Action không hợp lệ: ${invalid.join(", ")}` } };
    }

    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    if (folder.parent_id) {
      return {
        error: { status: 400, message: "Chỉ thư mục gốc mới được cấu hình quyền mặc định" }
      };
    }

    folder.defaultActions = defaultActions;
    await folder.save();

    const rootFolderId = await getRootFolderId(folder._id);

    await createAuditLog({
      rootFolderId,
      folderId: folder._id,
      targetType: TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: AUDIT_ACTION.UPDATE_DEFAULT_ACTIONS,
      performedBy: accountId,
      targetName: folder.name,
      message: mappingMessageAuditLog.UPDATE_DEFAULT_ACTIONS(folder.name)
    });

    return { data: folder };
  },

  async updateAutoCleanup(accountId, folderId, { autoCleanup, autoCleanupDays }) {
    const folder = await SharedFolderModel.findOne({ _id: folderId, isDeleted: false });
    if (!folder) return { error: { status: 404, message: "Không tìm thấy thư mục" } };

    if (!(await canDoFolderAction(accountId, folder, "manage"))) {
      return { error: { status: 403, message: "Bạn không có quyền cấu hình thư mục này" } };
    }

    if (folder.parent_id) {
      return {
        error: {
          status: 400,
          message: "Chỉ thư mục gốc mới được cấu hình tự động dọn dẹp"
        }
      };
    }

    if (autoCleanup !== undefined) {
      if (typeof autoCleanup !== "boolean") {
        return { error: { status: 400, message: "autoCleanup phải là boolean" } };
      }
      folder.autoCleanup = autoCleanup;
    }

    if (autoCleanupDays !== undefined) {
      const days = Number(autoCleanupDays);
      if (!Number.isInteger(days) || days < 1) {
        return { error: { status: 400, message: "autoCleanupDays phải là số nguyên >= 1" } };
      }
      folder.autoCleanupDays = days;
    }

    await folder.save();
    const rootFolderId = await getRootFolderId(folder._id);

    await createAuditLog({
      rootFolderId,
      folderId: folder._id,
      targetType: TARGET_TYPES.FOLDER,
      targetId: folder._id,
      action: AUDIT_ACTION.UPDATE_AUTO_CLEANUP,
      performedBy: accountId,
      targetName: folder.name,
      message: mappingMessageAuditLog.UPDATE_AUTO_CLEANUP(folder.name)
    });

    return {
      data: {
        _id: folder._id,
        name: folder.name,
        autoCleanup: folder.autoCleanup,
        autoCleanupDays: folder.autoCleanupDays
      }
    };
  },

  async getAuditLogs(rootFolderId, { folderId, action, targetType, page = 1, limit = 20 } = {}) {
    const filter = { rootFolderId };
    if (folderId) filter.folderId = folderId;
    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const [logs, total] = await Promise.all([
      SharedFolderAuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
      SharedFolderAuditLogModel.countDocuments(filter)
    ]);

    const profileMap = await getUserAuditProfileMap(logs.map((l) => l.performedBy));

    const data = logs.map((l) => {
      const obj = l.toJSON();
      const profile = profileMap[obj.performedBy?.toString()] ?? {};
      obj.performedBy = {
        _id: obj.performedBy,
        username: profile.username ?? null,
        full_name: profile.full_name ?? null,
        department_name: profile.department_name ?? null,
        position_name: profile.position_name ?? null
      };
      return obj;
    });

    return {
      data: {
        items: data,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  },

  async getFileAuditLogs(fileId, { page = 1, limit = 20 } = {}) {
    const filter = { targetType: "file", targetId: fileId };

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const [logs, total] = await Promise.all([
      SharedFolderAuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
      SharedFolderAuditLogModel.countDocuments(filter)
    ]);

    const profileMap = await getUserAuditProfileMap(logs.map((l) => l.performedBy));

    const data = logs.map((l) => {
      const obj = l.toJSON();
      const profile = profileMap[obj.performedBy?.toString()] ?? {};
      obj.performedBy = {
        _id: obj.performedBy,
        username: profile.username ?? null,
        full_name: profile.full_name ?? null,
        department_name: profile.department_name ?? null,
        position_name: profile.position_name ?? null
      };
      return obj;
    });

    return {
      data: {
        items: data,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  },

  async clearAuditLogs(rootFolderId) {
    const result = await SharedFolderAuditLogModel.deleteMany({ rootFolderId });
    return { data: { deletedCount: result.deletedCount } };
  }
};

module.exports = { SharedFolderService, safeUnlink };

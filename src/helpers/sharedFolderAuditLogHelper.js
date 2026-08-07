const AccountModel = require("../models/AccountModel");
const SharedFolderAuditLogModel = require("../models/SharedFolderAuditLogModel");
const SharedFolderModel = require("../models/SharedFolderModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const UserInfoModel = require("../models/UserInfoModel");

async function getUserAuditProfileMap(accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean).map((id) => id.toString()))];
  if (!ids.length) return {};

  const [accounts, userInfos] = await Promise.all([
    AccountModel.find({ _id: { $in: ids } }).select("username"),
    UserInfoModel.find({ id_account: { $in: ids }, isDeleted: false }).select(
      "id_account full_name ma_nv"
    )
  ]);

  const userInfoIds = userInfos.map((u) => u._id);
  const positions = userInfoIds.length
    ? await UserDepartmentPositionModel.find({
        user: { $in: userInfoIds },
        isDeleted: false
      })
        .populate("department", "department_name")
        .populate("position", "name")
    : [];

  const accountUsernameMap = Object.fromEntries(
    accounts.map((a) => [a._id.toString(), a.username])
  );

  const userInfoByAccount = Object.fromEntries(userInfos.map((u) => [u.id_account.toString(), u]));

  const positionsByUserInfoId = {};
  positions.forEach((p) => {
    const key = p.user.toString();
    if (!positionsByUserInfoId[key]) positionsByUserInfoId[key] = [];
    positionsByUserInfoId[key].push({
      department_name: p.department?.department_name ?? null,
      position_name: p.position?.name ?? null
    });
  });

  const result = {};
  for (const id of ids) {
    const info = userInfoByAccount[id];
    const posList = info ? (positionsByUserInfoId[info._id.toString()] ?? []) : [];

    result[id] = {
      username: accountUsernameMap[id] ?? null,
      full_name: info?.full_name ?? null,
      ma_nv: info?.ma_nv ?? null,
      positions: posList,
      department_name: posList[0]?.department_name ?? null,
      position_name: posList[0]?.position_name ?? null
    };
  }
  return result;
}

const getRootFolderId = async (folderId, fallbackId = null) => {
  if (!folderId) return fallbackId;

  let currentFolder = await SharedFolderModel.findOne({
    _id: folderId,
    isDeleted: false
  }).select("_id parent_id");

  if (!currentFolder) return fallbackId;

  while (currentFolder.parent_id) {
    const parentFolder = await SharedFolderModel.findOne({
      _id: currentFolder.parent_id,
      isDeleted: false
    }).select("_id parent_id");

    if (!parentFolder) break;
    currentFolder = parentFolder;
  }

  return currentFolder._id;
};

const createAuditLog = async ({
  rootFolderId,
  folderId = null,
  targetType,
  targetId,
  action,
  performedBy,
  targetName = null,
  message = ""
}) => {
  return SharedFolderAuditLogModel.create({
    rootFolderId,
    folderId,
    targetType,
    targetId,
    action,
    performedBy,
    targetName,
    message
  });
};

const mappingMessageAuditLog = Object.freeze({
  // File
  UPLOAD_FILE: (fileName) => `Đã tải lên file "${fileName}"`,
  DELETE_FILE: (fileName) => `Đã xóa file "${fileName}"`,
  RENAME_FILE: (oldName, newName) => `Đã đổi tên file "${oldName}" thành "${newName}"`,
  MOVE_FILE: (fileName, oldFolderName, newFolderName) =>
    `Đã di chuyển file "${fileName}" từ "${oldFolderName}" sang "${newFolderName}"`,
  VIEW_FILE: (fileName) => `Đã xem file "${fileName}"`,
  DOWNLOAD_FILE: (fileName) => `Đã tải xuống file "${fileName}"`,
  AUTO_CLEANUP_DELETE_FILE: (fileName) =>
    `Hệ thống tự động xóa file "${fileName}" do quá hạn lưu trữ`,
  // Folder
  VIEW_FOLDER: (folderName) => `Đã mở xem thư mục "${folderName}"`,
  CREATE_FOLDER: (folderName) => `Đã tạo thư mục "${folderName}"`,
  DELETE_FOLDER: (folderName) => `Đã xóa thư mục "${folderName}"`,
  RENAME_FOLDER: (oldName, newName) => `Đã đổi tên thư mục "${oldName}" thành "${newName}"`,
  MOVE_FOLDER: (folderName, oldParentName, newParentName) =>
    `Đã di chuyển thư mục "${folderName}" từ "${oldParentName}" sang "${newParentName}"`,
  UPDATE_PERMISSIONS: (folderName) => `Đã cập nhật phân quyền cho thư mục "${folderName}"`,
  UPDATE_DEFAULT_ACTIONS: (folderName) => `Đã cập nhật quyền mặc định cho thư mục "${folderName}"`,
  UPDATE_AUTO_CLEANUP: (folderName) =>
    `Đã cập nhật cấu hình tự động dọn dẹp cho thư mục "${folderName}"`,
  AUTO_CLEANUP_DELETE_FOLDER: (folderName) =>
    `Hệ thống tự động xóa thư mục "${folderName}" (và toàn bộ nội dung bên trong) do quá hạn lưu trữ`
});

module.exports = {
  getRootFolderId,
  createAuditLog,
  getUserAuditProfileMap,
  mappingMessageAuditLog
};

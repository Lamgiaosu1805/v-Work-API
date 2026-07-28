const { PERMISSION } = require("../constants");
const { getUserDeptIds } = require("../controllers/InternalFileController");
const AccountModel = require("../models/AccountModel");
const SharedFolderModel = require("../models/SharedFolderModel");
const { FOLDER_ACTION } = require("../models/SharedFolderModel");
const { can } = require("./rbac");

const ROOT_ACTION_PERMISSION_MAP = {
  [FOLDER_ACTION.DOWNLOAD]: PERMISSION.FOLDER_SHARED_DOWNLOAD,
  [FOLDER_ACTION.UPLOAD]: PERMISSION.FOLDER_SHARED_UPLOAD,
  [FOLDER_ACTION.DELETE_FILE]: PERMISSION.FOLDER_SHARED_DELETE_FILE,
  [FOLDER_ACTION.MANAGE]: PERMISSION.FOLDER_SHARED_MANAGE
};

async function canDoRootAction(accountId, action) {
  if (action === FOLDER_ACTION.VIEW) return true;

  const account = await AccountModel.findById(accountId);
  const permissionCode = ROOT_ACTION_PERMISSION_MAP[action];

  if (!permissionCode) return false;

  return can(account, permissionCode);
}

// Trả về danh sách actions user được phép làm trên 1 shared_folder cụ thể
async function getSharedFolderActions(accountId, folder) {
  const account = await AccountModel.findById(accountId);
  if (account?.username === "admin") return Object.values(FOLDER_ACTION);

  if (await can(account, PERMISSION.FOLDER_SHARED_MANAGE)) {
    return Object.values(FOLDER_ACTION);
  }

  const userDeptIds = await getUserDeptIds(accountId);

  const entry = folder.permissions.find((p) => {
    if (p.subjectType === "user") return p.subjectId.toString() === accountId.toString();
    if (p.subjectType === "department") return userDeptIds.includes(p.subjectId.toString());
    return false;
  });

  return entry ? entry.actions : folder.defaultActions;
}

async function canDoFolderAction(accountId, folder, action) {
  const actions = await getSharedFolderActions(accountId, folder);
  return actions.includes(action);
}

// User có thấy folder này tồn tại không (dựa trên scope, tách biệt với action cụ thể)
async function canSeeFolder(accountId, folder) {
  const account = await AccountModel.findById(accountId);
  if (account?.username === "admin") return true;
  if (await can(account, PERMISSION.FOLDER_SHARED_MANAGE)) return true;
  if (folder.scope === "all_departments") return true;

  const userDeptIds = await getUserDeptIds(accountId);
  return folder.visibleDepartments.some((d) => userDeptIds.includes(d.toString()));
}

// Query filter tương ứng với canSeeFolder — dùng trong list để lọc ngay ở DB
async function buildVisibilityFilter(accountId) {
  const account = await AccountModel.findById(accountId);
  if (account?.username === "admin") return {};
  if (await can(account, PERMISSION.FOLDER_SHARED_MANAGE)) return {};

  const userDeptIds = await getUserDeptIds(accountId);
  return {
    $or: [
      { scope: "all_departments" },
      { scope: "specific_departments", visibleDepartments: { $in: userDeptIds } }
    ]
  };
}

// BFS collect tất cả folder con (kể cả chính nó)
async function getAllDescendantSharedFolderIds(folderId) {
  const result = [];
  const queue = [folderId.toString()];
  while (queue.length > 0) {
    const currentId = queue.shift();
    result.push(currentId);
    const children = await SharedFolderModel.find({
      parent_id: currentId,
      isDeleted: false
    }).select("_id");
    queue.push(...children.map((c) => c._id.toString()));
  }
  return result;
}

// Check quyền action trên 1 file, dựa vào folder chứa nó (nếu có folder_id)
async function canDoFileAction(accountId, file, action) {
  if (!file.folder_id) {
    return canDoRootAction(accountId, action);
  }
  const folder = await SharedFolderModel.findOne({ _id: file.folder_id, isDeleted: false });
  if (!folder) return canDoRootAction(accountId, action);
  return canDoFolderAction(accountId, folder, action);
}

module.exports = {
  getSharedFolderActions,
  canDoFolderAction,
  canSeeFolder,
  buildVisibilityFilter,
  getAllDescendantSharedFolderIds,
  canDoFileAction
};

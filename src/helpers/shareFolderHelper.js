const AccountModel = require("../models/AccountModel");
const SharedFolderModel = require("../models/SharedFolderModel");
const { getUserDeptIds } = require("../controllers/InternalFileController");
const { FOLDER_ACTION } = require("../models/SharedFolderModel");

function isSuperAdminAccount(account) {
  return account?.username === "admin";
}

async function canDoRootAction(accountId, action) {
  if (action === FOLDER_ACTION.VIEW) return true;
  const account = await AccountModel.findById(accountId);
  return isSuperAdminAccount(account);
}

async function getAncestorChain(folder) {
  const chain = [folder];
  let current = folder;
  let guard = 0;

  while (current.parent_id && guard < 50) {
    const parent = await SharedFolderModel.findOne({ _id: current.parent_id, isDeleted: false });
    if (!parent) break;
    chain.push(parent);
    current = parent;
    guard++;
  }
  return chain;
}

async function getSharedFolderActions(accountId, folder) {
  const account = await AccountModel.findById(accountId);
  if (isSuperAdminAccount(account)) return Object.values(FOLDER_ACTION);

  const userDeptIds = await getUserDeptIds(accountId);
  const chain = await getAncestorChain(folder);

  const matchedActions = new Set();

  for (const node of chain) {
    const entry = node.permissions.find((p) => {
      if (p.subjectType === "user") return p.subjectId.toString() === accountId.toString();
      if (p.subjectType === "department") return userDeptIds.includes(p.subjectId.toString());
      return false;
    });
    if (entry) {
      entry.actions.forEach((a) => matchedActions.add(a));
    }
  }

  const rootFolder = chain[chain.length - 1];
  (rootFolder.defaultActions ?? []).forEach((a) => matchedActions.add(a));

  return Array.from(matchedActions);
}

async function canDoFolderAction(accountId, folder, action) {
  const actions = await getSharedFolderActions(accountId, folder);
  return actions.includes(action);
}

// User có thấy folder này tồn tại không
async function canSeeFolder(accountId, folder) {
  const account = await AccountModel.findById(accountId);
  if (isSuperAdminAccount(account)) return true;
  if (folder.scope === "all_departments") return true;

  const userDeptIds = await getUserDeptIds(accountId);
  return folder.visibleDepartments.some((d) => userDeptIds.includes(d.toString()));
}

// Query filter tương ứng với canSeeFolder — dùng trong list để lọc ngay ở DB
async function buildVisibilityFilter(accountId) {
  const account = await AccountModel.findById(accountId);
  if (isSuperAdminAccount(account)) return {};

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
  isSuperAdminAccount,
  getSharedFolderActions,
  canDoFolderAction,
  canSeeFolder,
  buildVisibilityFilter,
  getAllDescendantSharedFolderIds,
  canDoFileAction
};

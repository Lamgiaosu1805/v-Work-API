const UserInfoModel = require("../models/UserInfoModel");
const AccountModel = require("../models/AccountModel");
const DepartmentModel = require("../models/DepartmentModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const { can } = require("./rbac");
const { PERMISSION } = require("../constants");

async function buildCandidate(userInfo, account) {
  if (!userInfo || !account) return null;

  const membership = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false
  })
    .populate("position", "position_name")
    .populate("department", "department_name");

  return {
    userInfoId: userInfo._id,
    accountId: account._id,
    full_name: userInfo.full_name,
    position_name: membership?.position?.position_name ?? null,
    department_name: membership?.department?.department_name ?? null
  };
}

async function resolveDepartmentHead(employeeUserInfoId) {
  const membership = await UserDepartmentPositionModel.findOne({
    user: employeeUserInfoId,
    isDeleted: false
  });
  if (!membership) return null;

  const deptMemberIds = await UserDepartmentPositionModel.find({
    department: membership.department,
    isDeleted: false,
    user: { $ne: employeeUserInfoId }
  }).distinct("user");
  if (!deptMemberIds.length) return null;

  const userInfos = await UserInfoModel.find(
    { _id: { $in: deptMemberIds }, isDeleted: false },
    { full_name: 1, id_account: 1 }
  );
  if (!userInfos.length) return null;

  const accounts = await AccountModel.find({
    _id: { $in: userInfos.map((u) => u.id_account) },
    isDeleted: false
  }).sort({ createdAt: 1 });

  for (const account of accounts) {
    if (await can(account, PERMISSION.HRM_REQUEST_REVIEW)) {
      const userInfo = userInfos.find((u) => String(u.id_account) === String(account._id));
      return buildCandidate(userInfo, account);
    }
  }

  return null;
}

async function resolveIndirectManagerOrAdmin(employeeUserInfoId) {
  const membership = await UserDepartmentPositionModel.findOne({
    user: employeeUserInfoId,
    isDeleted: false
  });

  if (membership) {
    const department = await DepartmentModel.findById(membership.department, { manager: 1 });
    if (department?.manager) {
      const managerInfo = await UserInfoModel.findOne({
        _id: department.manager,
        isDeleted: false
      });
      if (managerInfo) {
        const account = await AccountModel.findOne({
          _id: managerInfo.id_account,
          isDeleted: false
        });
        if (account) return buildCandidate(managerInfo, account);
      }
    }
  }

  const adminAccount = await AccountModel.findOne({ role: "admin", isDeleted: false }).sort({
    createdAt: 1
  });
  if (!adminAccount) return null;
  const adminUserInfo = await UserInfoModel.findOne({
    id_account: adminAccount._id,
    isDeleted: false
  });
  if (!adminUserInfo) return null;

  return buildCandidate(adminUserInfo, adminAccount);
}

async function getApprovalChain(employeeUserInfoId) {
  const [level1, level2] = await Promise.all([
    resolveDepartmentHead(employeeUserInfoId),
    resolveIndirectManagerOrAdmin(employeeUserInfoId)
  ]);

  const seenAccounts = new Set();
  return [level1, level2].filter((c) => {
    if (!c) return false;
    if (String(c.userInfoId) === String(employeeUserInfoId)) return false;
    const key = String(c.accountId);
    if (seenAccounts.has(key)) return false;
    seenAccounts.add(key);
    return true;
  });
}

async function getManagedUserIds(managerUserInfoId) {
  const manager = await UserInfoModel.findById(managerUserInfoId, { branch_id: 1, isDeleted: 1 });
  if (!manager || manager.isDeleted) return [];

  const [ownDepts, managedDepts] = await Promise.all([
    UserDepartmentPositionModel.find({
      user: managerUserInfoId,
      isDeleted: false
    }).distinct("department"),
    DepartmentModel.find({ manager: managerUserInfoId, isDeleted: false }).distinct("_id")
  ]);
  const isTier2Manager = managedDepts.length > 0;
  const startDepts = [...new Set([...ownDepts, ...managedDepts].map(String))];
  if (!startDepts.length) return [];

  const seenDeptIds = new Set(startDepts);
  let frontier = startDepts;

  while (frontier.length) {
    const children = await DepartmentModel.find(
      { parent: { $in: frontier }, isDeleted: false },
      { _id: 1 }
    );
    const newIds = children.map((d) => String(d._id)).filter((id) => !seenDeptIds.has(id));
    if (!newIds.length) break;
    newIds.forEach((id) => seenDeptIds.add(id));
    frontier = newIds;
  }

  const members = await UserDepartmentPositionModel.find({
    department: { $in: [...seenDeptIds] },
    isDeleted: false,
    user: { $ne: managerUserInfoId }
  }).distinct("user");
  if (!members.length) return [];

  const employeeFilter = { _id: { $in: members }, isDeleted: false };
  if (!isTier2Manager) employeeFilter.branch_id = manager.branch_id;

  const employees = await UserInfoModel.find(employeeFilter, { _id: 1 });

  return employees.map((e) => e._id);
}

module.exports = { getApprovalChain, getManagedUserIds };

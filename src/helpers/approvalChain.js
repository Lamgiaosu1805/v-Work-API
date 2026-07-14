const UserInfoModel = require("../models/UserInfoModel");
const AccountModel = require("../models/AccountModel");
const DepartmentModel = require("../models/DepartmentModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const { can } = require("./rbac");
const { PERMISSION } = require("../constants");

async function getApprovalChain(userInfoId, { stopAtFirstMatch = false } = {}) {
  const employee = await UserInfoModel.findById(userInfoId, { branch_id: 1, isDeleted: 1 });
  if (!employee || employee.isDeleted) return [];

  const memberships = await UserDepartmentPositionModel.find({
    user: userInfoId,
    isDeleted: false
  }).distinct("department");
  if (!memberships.length) return [];

  const seenDeptIds = new Set();
  const chain = [];
  const seenUsers = new Set();
  let frontier = memberships.map(String);

  while (frontier.length && seenDeptIds.size < 50) {
    const newFrontier = frontier.filter((id) => !seenDeptIds.has(id));
    if (!newFrontier.length) break;
    newFrontier.forEach((id) => seenDeptIds.add(id));

    const candidateUserIds = await UserDepartmentPositionModel.find({
      department: { $in: newFrontier },
      isDeleted: false,
      user: { $ne: userInfoId }
    }).distinct("user");

    if (candidateUserIds.length) {
      const candidates = await UserInfoModel.find(
        { _id: { $in: candidateUserIds }, isDeleted: false },
        { branch_id: 1, full_name: 1, id_account: 1 }
      );

      const branchMatched = candidates.filter(
        (c) => employee.branch_id && c.branch_id && employee.branch_id.equals(c.branch_id)
      );

      const accounts = await AccountModel.find(
        { _id: { $in: branchMatched.map((c) => c.id_account) }, isDeleted: false },
        { role: 1 }
      );
      const accountMap = new Map(accounts.map((a) => [String(a._id), a]));

      const permissionChecks = await Promise.all(
        branchMatched.map((c) => {
          const account = accountMap.get(String(c.id_account));
          return account ? can(account, PERMISSION.HRM_REQUEST_REVIEW) : Promise.resolve(false);
        })
      );

      branchMatched.forEach((c, i) => {
        if (!permissionChecks[i] || seenUsers.has(String(c._id))) return;
        seenUsers.add(String(c._id));
        chain.push({ userInfoId: c._id, accountId: c.id_account, full_name: c.full_name });
      });
    }

    const depts = await DepartmentModel.find(
      { _id: { $in: newFrontier }, isDeleted: false },
      { parent: 1, manager: 1 }
    );
    const managerIds = [
      ...new Set(
        depts
          .map((d) => d.manager)
          .filter(Boolean)
          .map(String)
      )
    ].filter((id) => !seenUsers.has(id));
    if (managerIds.length) {
      const managerInfos = await UserInfoModel.find(
        { _id: { $in: managerIds }, isDeleted: false },
        { full_name: 1, id_account: 1 }
      );
      managerInfos.forEach((c) => {
        if (seenUsers.has(String(c._id))) return;
        seenUsers.add(String(c._id));
        chain.push({ userInfoId: c._id, accountId: c.id_account, full_name: c.full_name });
      });
    }

    if (stopAtFirstMatch && chain.length) break;

    // Lên 1 cấp
    frontier = depts
      .map((d) => d.parent)
      .filter(Boolean)
      .map(String);
  }

  return chain;
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

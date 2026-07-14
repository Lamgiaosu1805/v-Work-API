const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const DepartmentModel = require("../models/DepartmentModel");

async function getAccountTtkdIds(accountId) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false })
    .select("_id")
    .lean();
  if (!userInfo) return [];

  const deptIds = await UserDepartmentPositionModel.distinct("department", {
    user: userInfo._id,
    isDeleted: false
  });
  if (!deptIds.length) return [];

  const ttkds = await DepartmentModel.find({
    _id: { $in: deptIds },
    type: "branch",
    isDeleted: false
  })
    .select("_id")
    .lean();

  return ttkds.map((t) => t._id);
}

async function getSaleInfoIdsInTtkds(ttkdIds) {
  if (!ttkdIds || !ttkdIds.length) return [];
  return UserDepartmentPositionModel.distinct("user", {
    department: { $in: ttkdIds },
    isDeleted: false
  });
}

async function getSaleTtkdId(saleInfoId) {
  const deptIds = await UserDepartmentPositionModel.distinct("department", {
    user: saleInfoId,
    isDeleted: false
  });
  if (!deptIds.length) return null;

  const ttkd = await DepartmentModel.findOne({
    _id: { $in: deptIds },
    type: "branch",
    isDeleted: false
  })
    .select("_id")
    .lean();

  return ttkd?._id ?? null;
}

async function getUserInfoIdFromAccount(accountId) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false })
    .select("_id")
    .lean();
  return userInfo ? userInfo._id : null;
}

module.exports = {
  getAccountTtkdIds,
  getSaleInfoIdsInTtkds,
  getSaleTtkdId,
  getUserInfoIdFromAccount
};

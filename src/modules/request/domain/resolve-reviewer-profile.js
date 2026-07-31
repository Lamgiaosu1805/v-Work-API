const UserInfoModel = require("../../../models/UserInfoModel");
const UserDepartmentPositionModel = require("../../../models/UserDepartmentPositionModel");

async function resolveReviewerProfileByAccountId(accountId) {
  if (!accountId) return null;
  const userInfo = await UserInfoModel.findOne(
    { id_account: accountId, isDeleted: false },
    { full_name: 1 }
  );
  if (!userInfo) return null;

  const membership = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false
  })
    .populate("position", "position_name")
    .populate("department", "department_name");

  return {
    userInfoId: userInfo._id,
    full_name: userInfo.full_name,
    position_name: membership?.position?.position_name ?? null,
    department_name: membership?.department?.department_name ?? null
  };
}

module.exports = { resolveReviewerProfileByAccountId };

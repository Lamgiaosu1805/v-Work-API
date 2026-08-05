const UserInfoModel = require("../../../models/UserInfoModel");
const { getApprovalChain } = require("../../../helpers/approvalChain");
const { NotFoundException } = require("../../../core/exceptions/exceptions");

async function getEligibleReviewers(accountId) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const chain = await getApprovalChain(userInfo._id);
  return chain[0] ?? null;
}

module.exports = { getEligibleReviewers };

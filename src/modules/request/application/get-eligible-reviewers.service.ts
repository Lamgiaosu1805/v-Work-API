import UserInfoModel from "../../../models/UserInfoModel";
import { getApprovalChain } from "../domain/approval-chain";
import { NotFoundException } from "../../../core/exceptions/exceptions";

export async function getEligibleReviewers(accountId: unknown) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const chain = await getApprovalChain(userInfo._id);
  return chain[0] ?? null;
}

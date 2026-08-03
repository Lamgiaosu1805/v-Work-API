import UserInfoModel from "../../../models/UserInfoModel";
import { getApprovalChain } from "../domain/approval-chain";
import { NotFoundException } from "../../../core/exceptions/exceptions";

// Trả đủ cả chuỗi phê duyệt (cấp 1: quản lý trực tiếp + cấp 2: quản lý gián tiếp/admin) — trước đây
// chỉ trả `chain[0]` (mỗi cấp 1), FE không có cách nào hiển thị cấp 2 trong luồng phê duyệt.
export async function getEligibleReviewers(accountId: unknown) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  return getApprovalChain(userInfo._id);
}

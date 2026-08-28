import UserInfoModel from "../../models/UserInfoModel";
import { NotFoundException } from "../exceptions/exceptions";

export async function resolveEmployeeId(accountId: string): Promise<string> {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false })
    .select("_id")
    .lean();
  if (!userInfo) {
    throw new NotFoundException("Không tìm thấy thông tin nhân viên");
  }
  return String((userInfo as { _id: unknown })._id);
}

import UserInfoModel from "../models/UserInfoModel";
import { ArgumentInvalidException, NotFoundException } from "../core/exceptions/exceptions";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function setCrmSaleEmployeeEmail(employeeId: string, email: string): Promise<void> {
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    throw new ArgumentInvalidException("Email không hợp lệ");
  }

  const userInfo = await UserInfoModel.findOne({ _id: employeeId, isDeleted: false }).select("_id");
  if (!userInfo) {
    throw new NotFoundException("Không tìm thấy nhân viên", { metadata: { employeeId } });
  }

  const duplicateOwner = await UserInfoModel.findOne({
    email: trimmedEmail,
    isDeleted: false,
    _id: { $ne: employeeId }
  }).select("full_name");
  if (duplicateOwner) {
    throw new ArgumentInvalidException(
      `Email này đã được dùng bởi nhân viên khác (${(duplicateOwner as { full_name?: string }).full_name || "không rõ tên"})`
    );
  }

  await UserInfoModel.updateOne({ _id: employeeId }, { email: trimmedEmail });
}

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

  await UserInfoModel.updateOne({ _id: employeeId }, { email: trimmedEmail });
}

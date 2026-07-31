import UserInfoModel from "../../../models/UserInfoModel";
import UserDepartmentPositionModel from "../../../models/UserDepartmentPositionModel";
import { ReviewerProfile } from "./types";

export async function resolveReviewerProfileByAccountId(
  accountId: unknown
): Promise<ReviewerProfile | null> {
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
    position_name: (membership?.position as { position_name?: string })?.position_name ?? null,
    department_name:
      (membership?.department as { department_name?: string })?.department_name ?? null
  };
}

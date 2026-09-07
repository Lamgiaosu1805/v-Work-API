import UserInfoModel from "../models/UserInfoModel";
import AccountModel from "../models/AccountModel";

export interface CrmSaleInviteCandidateEmployee {
  employeeId: string;
  fullName: string;
  email: string | null;
}

export async function listCrmSaleInviteCandidateEmployees(): Promise<
  CrmSaleInviteCandidateEmployee[]
> {
  const userInfos = await UserInfoModel.find({ isDeleted: false })
    .select("full_name email id_account")
    .lean();

  const accountIds = userInfos.map((userInfo: any) => userInfo.id_account);
  const activeAccounts = await AccountModel.find({
    _id: { $in: accountIds },
    isDeleted: false
  })
    .select("_id")
    .lean();
  const activeAccountIds = new Set(activeAccounts.map((account: any) => String(account._id)));

  return userInfos
    .filter((userInfo: any) => activeAccountIds.has(String(userInfo.id_account)))
    .map((userInfo: any) => ({
      employeeId: String(userInfo._id),
      fullName: userInfo.full_name,
      email: userInfo.email ?? null
    }));
}

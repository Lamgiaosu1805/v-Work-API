import { OmicallClient } from "../../../utils/omicallClient";
import UserInfoModel from "../../../models/UserInfoModel";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const omicallClient = new OmicallClient();
const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export interface ListHotlineExtensionsFilters {
  keyword?: string;
}

export interface HotlineExtensionOption {
  sip_user: string;
  full_name: string;
  ma_nv: string;
  agent_id: string | null;
  email: string | null;
}

export interface ListHotlineExtensionsResult {
  items: HotlineExtensionOption[];
}

export async function listHotlineExtensions(
  filters: ListHotlineExtensionsFilters
): Promise<ListHotlineExtensionsResult> {
  const result = await omicallClient.listInternalPhones({
    keyword: filters.keyword,
    page: 1,
    size: 200
  });
  const items = result.items ?? [];
  const extensions = items.map((item) => item.sip_user).filter(Boolean);

  const profiles = extensions.length
    ? await saleOmicallProfileRepository.findManyByExtensions(extensions)
    : [];
  const saleIdByExtension = new Map(
    profiles.map((profile) => [profile.omicallExtension, profile.saleId])
  );
  const saleIds = profiles.map((profile) => profile.saleId);

  const userInfos = saleIds.length
    ? await UserInfoModel.find({ _id: { $in: saleIds }, isDeleted: false })
        .select("full_name ma_nv")
        .lean()
    : [];
  const userInfoById = new Map(
    userInfos.map((userInfo: { _id: unknown; full_name?: string; ma_nv?: string }) => [
      String(userInfo._id),
      { fullName: userInfo.full_name, maNv: userInfo.ma_nv }
    ])
  );

  const options: HotlineExtensionOption[] = [];
  items.forEach((item) => {
    const saleId = saleIdByExtension.get(item.sip_user);
    const userInfo = saleId ? userInfoById.get(saleId) : undefined;
    if (!userInfo || !userInfo.maNv) return;
    options.push({
      sip_user: item.sip_user,
      full_name: userInfo.fullName || "",
      ma_nv: userInfo.maNv,
      agent_id: item.agent_id ?? null,
      email: item.email ?? null
    });
  });

  return { items: options };
}

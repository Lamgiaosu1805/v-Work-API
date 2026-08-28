import mongoose from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { OmicallClient } from "../../../utils/omicallClient";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { SaleOmicallProfileEntity } from "../domain/sale-omicall-profile.entity";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();
const omicallClient = new OmicallClient();

export interface SipCredentials {
  sipRealm: string;
  sipUser: string;
  sipPassword: string;
}

export async function getSipCredentials(
  employeeId: string,
  forceRefresh = false
): Promise<SipCredentials> {
  const existing = await saleOmicallProfileRepository.findBySaleId(employeeId);
  if (existing && !forceRefresh) {
    return {
      sipRealm: existing.sipRealm,
      sipUser: existing.omicallExtension,
      sipPassword: existing.sipPassword
    };
  }

  const userInfo = await UserInfoModel.findOne({ _id: employeeId, isDeleted: false })
    .select("email")
    .lean();
  const email = (userInfo as { email?: string | null } | null)?.email;
  if (!email) {
    throw new NotFoundException(
      "Chưa cập nhật email nhân viên — không thể đồng bộ tài khoản Omicall"
    );
  }

  const detail = await omicallClient.getExtensionDetail("user_email", email);
  if (!detail) {
    throw new NotFoundException("Không tìm thấy tài khoản Omicall theo email này");
  }

  const credentials: SipCredentials = {
    sipRealm: detail.pbx_account.sip_realm,
    sipUser: detail.pbx_account.sip_user,
    sipPassword: detail.pbx_account.sip_password
  };

  if (existing) {
    existing.update({
      sipRealm: credentials.sipRealm,
      omicallExtension: credentials.sipUser,
      sipPassword: credentials.sipPassword,
      omicallAgentId: existing.omicallAgentId,
      omicallEmail: email
    });
    await saleOmicallProfileRepository.updateById(existing.id, existing);
    return credentials;
  }

  const id = new mongoose.Types.ObjectId().toString();
  const profile = SaleOmicallProfileEntity.create({
    id,
    saleId: employeeId,
    sipRealm: credentials.sipRealm,
    omicallExtension: credentials.sipUser,
    sipPassword: credentials.sipPassword,
    omicallEmail: email
  });
  await saleOmicallProfileRepository.insert(profile);
  return credentials;
}

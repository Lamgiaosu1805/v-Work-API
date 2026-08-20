import PermissionCatalogModel from "../../../models/PermissionCatalogModel";
import DataScopePolicyModel from "../../../models/DataScopePolicyModel";
import FieldScopePolicyModel from "../../../models/FieldScopePolicyModel";
import {
  PermissionCatalogRepository,
  PermissionCatalogView
} from "../infrastructure/permission-catalog.repository";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";

const permissionCatalogRepository = new PermissionCatalogRepository();

export interface UpdatePermissionCatalogWhitelistsInput {
  validDataScopePolicies?: string[];
  validFieldScopePolicies?: string[];
}

function assertPoliciesBelongToEntity(
  docs: { code: string; entity: string }[],
  uniqueCodes: string[],
  entity: string,
  label: string
): void {
  if (docs.length !== uniqueCodes.length) {
    throw new ArgumentInvalidException(`Có ${label} không tồn tại hoặc đã bị xóa`);
  }
  const wrongEntity = docs.some((doc) => doc.entity !== entity);
  if (wrongEntity) {
    throw new ArgumentInvalidException(`${label} phải cùng entity "${entity}" với permission`);
  }
}

export async function updatePermissionCatalogWhitelists(
  code: string,
  input: UpdatePermissionCatalogWhitelistsInput
): Promise<PermissionCatalogView> {
  const permission = await PermissionCatalogModel.findOne({ code, isDeleted: false }).lean();
  if (!permission) {
    throw new NotFoundException("Không tìm thấy permission", { metadata: { code } });
  }

  if (input.validDataScopePolicies?.length) {
    const uniqueCodes = Array.from(new Set(input.validDataScopePolicies));
    const docs = await DataScopePolicyModel.find({ code: { $in: uniqueCodes }, isDeleted: false })
      .select("code entity")
      .lean();
    assertPoliciesBelongToEntity(docs, uniqueCodes, permission.entity, "Data Scope Policy");
  }

  if (input.validFieldScopePolicies?.length) {
    if (!permission.supportsFieldScope) {
      throw new ArgumentInvalidException(
        `Permission "${code}" (actionKind=${permission.actionKind}) không hỗ trợ Field Scope`
      );
    }
    const uniqueCodes = Array.from(new Set(input.validFieldScopePolicies));
    const docs = await FieldScopePolicyModel.find({ code: { $in: uniqueCodes }, isDeleted: false })
      .select("code entity")
      .lean();
    assertPoliciesBelongToEntity(docs, uniqueCodes, permission.entity, "Field Scope Policy");
  }

  const updated = await permissionCatalogRepository.updateWhitelistsByCode(code, input);
  if (!updated) {
    throw new NotFoundException("Không tìm thấy permission", { metadata: { code } });
  }
  return updated;
}

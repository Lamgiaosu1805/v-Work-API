import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import { RoleEntity } from "../domain/role.entity";
import { RoleRepository } from "../infrastructure/role.repository";
import { PermissionGrantProps } from "../domain/value-objects/permission-grant.vo";
import PermissionCatalogModel from "../../../models/PermissionCatalogModel";
import DataScopePolicyModel from "../../../models/DataScopePolicyModel";
import FieldScopePolicyModel from "../../../models/FieldScopePolicyModel";

const roleRepository = new RoleRepository();

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  grants?: PermissionGrantProps[];
}

async function assertGrantsReferenceExistingCatalogEntries(
  grants: PermissionGrantProps[]
): Promise<void> {
  const permissionCodes = Array.from(new Set(grants.map((grant) => grant.permissionCode)));
  const dataScopePolicyCodes = Array.from(
    new Set(grants.map((grant) => grant.dataScopePolicyCode))
  );
  const fieldScopePolicyCodes = Array.from(
    new Set(
      grants
        .map((grant) => grant.fieldScopePolicyCode)
        .filter((code): code is string => Boolean(code))
    )
  );

  const [permissionCount, dataScopeCount, fieldScopeCount] = await Promise.all([
    PermissionCatalogModel.countDocuments({ code: { $in: permissionCodes }, isDeleted: false }),
    DataScopePolicyModel.countDocuments({ code: { $in: dataScopePolicyCodes }, isDeleted: false }),
    fieldScopePolicyCodes.length
      ? FieldScopePolicyModel.countDocuments({
          code: { $in: fieldScopePolicyCodes },
          isDeleted: false
        })
      : Promise.resolve(0)
  ]);

  if (permissionCount !== permissionCodes.length) {
    throw new ArgumentInvalidException(
      "Có permissionCode không tồn tại hoặc đã bị xóa trong grants"
    );
  }
  if (dataScopeCount !== dataScopePolicyCodes.length) {
    throw new ArgumentInvalidException(
      "Có dataScopePolicyCode không tồn tại hoặc đã bị xóa trong grants"
    );
  }
  if (fieldScopeCount !== fieldScopePolicyCodes.length) {
    throw new ArgumentInvalidException(
      "Có fieldScopePolicyCode không tồn tại hoặc đã bị xóa trong grants"
    );
  }
}

export async function updateRole(id: string, input: UpdateRoleInput): Promise<RoleEntity> {
  const role = await roleRepository.findOneById(id);
  if (!role) throw new NotFoundException("Không tìm thấy vai trò", { metadata: { roleId: id } });

  if (input.name !== undefined || input.description !== undefined) {
    role.rename(input.name ?? role.name, input.description);
  }

  if (input.grants) {
    await assertGrantsReferenceExistingCatalogEntries(input.grants);

    const newPermissionCodes = new Set(input.grants.map((grant) => grant.permissionCode));
    role.grants.forEach((existing) => {
      if (!newPermissionCodes.has(existing.permissionCode)) {
        role.removeGrant(existing.permissionCode);
      }
    });
    input.grants.forEach((grant) => role.addGrant(grant));
  }

  await roleRepository.updateById(id, role);

  return role;
}

import mongoose from "mongoose";
import { EmployeePermissionProfileEntity } from "../domain/employee-permission-profile.entity";
import { EmployeePermissionProfileRepository } from "../infrastructure/employee-permission-profile.repository";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import UserInfoModel from "../../../models/UserInfoModel";
import DataScopePolicyModel from "../../../models/DataScopePolicyModel";
import FieldScopePolicyModel from "../../../models/FieldScopePolicyModel";
import { eventBus } from "../../../core/events/event-bus";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import "./handlers/invalidate-permission-cache.handler";

const employeePermissionProfileRepository = new EmployeePermissionProfileRepository();

export interface UpdateEmployeePermissionOverrideInput {
  permissionCode: string;
  status: "ALLOW" | "BLOCK";
  dataScopePolicyCode?: string | null;
  fieldScopePolicyCode?: string | null;
}

export interface UpdateEmployeePermissionInput {
  roleIds: string[];
  overrides: UpdateEmployeePermissionOverrideInput[];
}

async function assertOverridesReferenceExistingCatalogEntries(
  overrides: UpdateEmployeePermissionOverrideInput[]
): Promise<void> {
  const dataScopePolicyCodes = Array.from(
    new Set(
      overrides
        .map((override) => override.dataScopePolicyCode)
        .filter((code): code is string => Boolean(code))
    )
  );
  const fieldScopePolicyCodes = Array.from(
    new Set(
      overrides
        .map((override) => override.fieldScopePolicyCode)
        .filter((code): code is string => Boolean(code))
    )
  );

  const [dataScopeCount, fieldScopeCount] = await Promise.all([
    dataScopePolicyCodes.length
      ? DataScopePolicyModel.countDocuments({
          code: { $in: dataScopePolicyCodes },
          isDeleted: false
        })
      : Promise.resolve(0),
    fieldScopePolicyCodes.length
      ? FieldScopePolicyModel.countDocuments({
          code: { $in: fieldScopePolicyCodes },
          isDeleted: false
        })
      : Promise.resolve(0)
  ]);

  if (dataScopeCount !== dataScopePolicyCodes.length) {
    throw new ArgumentInvalidException(
      "Có dataScopePolicyCode không tồn tại hoặc đã bị xóa trong overrides"
    );
  }
  if (fieldScopeCount !== fieldScopePolicyCodes.length) {
    throw new ArgumentInvalidException(
      "Có fieldScopePolicyCode không tồn tại hoặc đã bị xóa trong overrides"
    );
  }
}

export async function updateEmployeePermission(
  employeeId: string,
  input: UpdateEmployeePermissionInput
): Promise<EmployeePermissionProfileEntity> {
  const employeeExists = await UserInfoModel.exists({ _id: employeeId, isDeleted: false });
  if (!employeeExists) {
    throw new NotFoundException("Không tìm thấy nhân viên", { metadata: { employeeId } });
  }

  if (input.roleIds.length > 0) {
    const uniqueRoleIds = Array.from(new Set(input.roleIds));
    const validRoleCount = await PermissionRoleModel.countDocuments({
      _id: { $in: uniqueRoleIds },
      isDeleted: false
    });
    if (validRoleCount !== uniqueRoleIds.length) {
      throw new ArgumentInvalidException(
        "Có vai trò không tồn tại hoặc đã bị xóa trong danh sách gán"
      );
    }
  }

  const existingProfile = await employeePermissionProfileRepository.findByEmployeeId(employeeId);
  const isNew = !existingProfile;
  const profile =
    existingProfile ??
    EmployeePermissionProfileEntity.create({
      id: new mongoose.Types.ObjectId().toString(),
      employeeId
    });

  const currentRoleIds = new Set(profile.roleIds);
  const newRoleIds = new Set(input.roleIds);
  currentRoleIds.forEach((roleId) => {
    if (!newRoleIds.has(roleId)) profile.unassignRole(roleId);
  });
  newRoleIds.forEach((roleId) => profile.assignRole(roleId));

  if (input.overrides.length > 0) {
    await assertOverridesReferenceExistingCatalogEntries(input.overrides);
  }

  const currentOverrideCodes = new Set(
    profile.overrides.map((override) => override.permissionCode)
  );
  const newOverrideCodes = new Set(input.overrides.map((override) => override.permissionCode));
  currentOverrideCodes.forEach((code) => {
    if (!newOverrideCodes.has(code)) profile.clearOverride(code);
  });
  input.overrides.forEach((override) =>
    profile.setOverride(
      override.permissionCode,
      override.status,
      override.dataScopePolicyCode,
      override.fieldScopePolicyCode
    )
  );

  if (isNew) {
    await employeePermissionProfileRepository.insert(profile);
  } else {
    await employeePermissionProfileRepository.updateById(profile.id, profile);
  }

  profile.publishEvents(eventBus).catch(() => {});

  return profile;
}

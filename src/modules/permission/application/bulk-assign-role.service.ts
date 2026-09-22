import mongoose from "mongoose";
import { EmployeePermissionProfileEntity } from "../domain/employee-permission-profile.entity";
import { EmployeePermissionProfileRepository } from "../infrastructure/employee-permission-profile.repository";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { eventBus } from "../../../core/events/event-bus";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import "./handlers/invalidate-permission-cache.handler";

const employeePermissionProfileRepository = new EmployeePermissionProfileRepository();

export interface BulkAssignRoleChangeInput {
  employeeId: string;
  shouldHave: boolean;
}

export async function bulkAssignRole(
  roleId: string,
  changes: BulkAssignRoleChangeInput[]
): Promise<{ updated: number }> {
  const roleExists = await PermissionRoleModel.exists({ _id: roleId, isDeleted: false });
  if (!roleExists) {
    throw new NotFoundException("Không tìm thấy vai trò", { metadata: { roleId } });
  }

  const employeeIds = Array.from(new Set(changes.map((change) => change.employeeId)));
  const validEmployeeCount = await UserInfoModel.countDocuments({
    _id: { $in: employeeIds },
    isDeleted: false
  });
  if (validEmployeeCount !== employeeIds.length) {
    throw new ArgumentInvalidException(
      "Có nhân viên không tồn tại hoặc đã bị xóa trong danh sách gán"
    );
  }

  await Promise.all(
    changes.map(async ({ employeeId, shouldHave }) => {
      const existingProfile = await employeePermissionProfileRepository.findByEmployeeId(
        employeeId
      );
      const isNew = !existingProfile;
      const profile =
        existingProfile ??
        EmployeePermissionProfileEntity.create({
          id: new mongoose.Types.ObjectId().toString(),
          employeeId
        });

      if (shouldHave) {
        profile.assignRole(roleId);
      } else {
        profile.unassignRole(roleId);
      }

      if (isNew) {
        await employeePermissionProfileRepository.insert(profile);
      } else {
        await employeePermissionProfileRepository.updateById(profile.id, profile);
      }

      profile.publishEvents(eventBus).catch(() => {});
    })
  );

  return { updated: changes.length };
}

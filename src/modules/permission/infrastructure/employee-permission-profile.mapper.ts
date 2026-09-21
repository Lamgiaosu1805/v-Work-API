import {
  EmployeePermissionProfileEntity,
  EmployeePermissionProfileProps
} from "../domain/employee-permission-profile.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const employeePermissionProfileMapper: Mapper<EmployeePermissionProfileEntity, any> = {
  toDomain(record) {
    return new EmployeePermissionProfileEntity(
      {
        id: String(record._id),
        props: {
          employeeId: String(record.employeeId),
          roleIds: (record.roleIds ?? []).map((roleId: any) => String(roleId)),
          overrides: (record.overrides ?? []).map((override: any) => ({
            permissionCode: override.permissionCode,
            status: override.status,
            dataScopePolicyCode: override.dataScopePolicyCode ?? null,
            fieldScopePolicyCode: override.fieldScopePolicyCode ?? null
          }))
        } as EmployeePermissionProfileProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const { id, createdAt, updatedAt, ...rest } = entity.getProps();
    return { _id: id, ...rest };
  }
};

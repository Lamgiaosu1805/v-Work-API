import { RoleEntity, RoleProps } from "../domain/role.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const roleMapper: Mapper<RoleEntity, any> = {
  toDomain(record) {
    return new RoleEntity(
      {
        id: String(record._id),
        props: {
          name: record.name,
          code: record.code,
          description: record.description ?? "",
          isSystemRole: record.isSystemRole,
          grants: (record.grants ?? []).map((grant: any) => ({
            permissionCode: grant.permissionCode,
            dataScopePolicyCode: grant.dataScopePolicyCode,
            fieldScopePolicyCode: grant.fieldScopePolicyCode ?? null
          }))
        } as RoleProps,
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

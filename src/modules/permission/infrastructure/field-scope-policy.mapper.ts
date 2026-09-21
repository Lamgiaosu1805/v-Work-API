import { FieldScopePolicyEntity, FieldScopePolicyProps } from "../domain/field-scope-policy.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const fieldScopePolicyMapper: Mapper<FieldScopePolicyEntity, any> = {
  toDomain(record) {
    return new FieldScopePolicyEntity(
      {
        id: String(record._id),
        props: {
          code: record.code,
          entity: record.entity,
          label: record.label,
          isSystemPolicy: record.isSystemPolicy,
          fields: record.fields ?? [],
          conditionTree: record.conditionTree ?? null
        } as FieldScopePolicyProps,
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

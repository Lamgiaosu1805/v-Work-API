import { DataScopePolicyEntity, DataScopePolicyProps } from "../domain/data-scope-policy.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const dataScopePolicyMapper: Mapper<DataScopePolicyEntity, any> = {
  toDomain(record) {
    return new DataScopePolicyEntity(
      {
        id: String(record._id),
        props: {
          code: record.code,
          entity: record.entity,
          label: record.label,
          isSystemPolicy: record.isSystemPolicy,
          conditionTree: record.conditionTree
        } as DataScopePolicyProps,
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

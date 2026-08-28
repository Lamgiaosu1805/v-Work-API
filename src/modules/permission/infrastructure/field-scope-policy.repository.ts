import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import FieldScopePolicyModel from "../../../models/FieldScopePolicyModel";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import { FieldScopePolicyEntity } from "../domain/field-scope-policy.entity";
import { fieldScopePolicyMapper } from "./field-scope-policy.mapper";

export class FieldScopePolicyRepository extends MongooseRepositoryBase<
  FieldScopePolicyEntity,
  any
> {
  constructor() {
    super(FieldScopePolicyModel, fieldScopePolicyMapper);
  }

  async findByCode(code: string): Promise<FieldScopePolicyEntity | null> {
    const doc = await this.model
      .findOne({ code, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async countRolesReferencing(policyCode: string): Promise<number> {
    return PermissionRoleModel.countDocuments({
      "grants.fieldScopePolicyCode": policyCode,
      isDeleted: false
    }).session(this.session ?? null);
  }
}

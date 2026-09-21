import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import DataScopePolicyModel from "../../../models/DataScopePolicyModel";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import { DataScopePolicyEntity } from "../domain/data-scope-policy.entity";
import { dataScopePolicyMapper } from "./data-scope-policy.mapper";

export class DataScopePolicyRepository extends MongooseRepositoryBase<DataScopePolicyEntity, any> {
  constructor() {
    super(DataScopePolicyModel, dataScopePolicyMapper);
  }

  async findByCode(code: string): Promise<DataScopePolicyEntity | null> {
    const doc = await this.model
      .findOne({ code, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async countRolesReferencing(policyCode: string): Promise<number> {
    return PermissionRoleModel.countDocuments({
      "grants.dataScopePolicyCode": policyCode,
      isDeleted: false
    }).session(this.session ?? null);
  }
}

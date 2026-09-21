import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import { RoleEntity } from "../domain/role.entity";
import { roleMapper } from "./role.mapper";

export class RoleRepository extends MongooseRepositoryBase<RoleEntity, any> {
  constructor() {
    super(PermissionRoleModel, roleMapper);
  }

  async findByCode(code: string): Promise<RoleEntity | null> {
    const doc = await this.model
      .findOne({ code, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findManyByIds(ids: string[]): Promise<RoleEntity[]> {
    if (!ids.length) return [];
    const docs = await this.model
      .find({ _id: { $in: ids }, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc: any) => this.mapper.toDomain(doc));
  }
}

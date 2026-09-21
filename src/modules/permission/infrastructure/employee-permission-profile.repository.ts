import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import EmployeePermissionProfileModel from "../../../models/EmployeePermissionProfileModel";
import { EmployeePermissionProfileEntity } from "../domain/employee-permission-profile.entity";
import { employeePermissionProfileMapper } from "./employee-permission-profile.mapper";

export class EmployeePermissionProfileRepository extends MongooseRepositoryBase<
  EmployeePermissionProfileEntity,
  any
> {
  constructor() {
    super(EmployeePermissionProfileModel, employeePermissionProfileMapper);
  }

  async findByEmployeeId(employeeId: string): Promise<EmployeePermissionProfileEntity | null> {
    const doc = await this.model
      .findOne({ employeeId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }

  async findAllByRoleId(roleId: string): Promise<EmployeePermissionProfileEntity[]> {
    const docs = await this.model
      .find({ roleIds: roleId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return docs.map((doc) => this.mapper.toDomain(doc));
  }
}

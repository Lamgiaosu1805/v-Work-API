import { NotFoundException } from "../../../core/exceptions/exceptions";
import { RoleEntity } from "../domain/role.entity";
import { RoleRepository } from "../infrastructure/role.repository";

const roleRepository = new RoleRepository();

export async function getRoleById(id: string): Promise<RoleEntity> {
  const role = await roleRepository.findOneById(id);
  if (!role) {
    throw new NotFoundException("Không tìm thấy vai trò", { metadata: { roleId: id } });
  }
  return role;
}

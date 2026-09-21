import { NotFoundException } from "../../../core/exceptions/exceptions";
import { RoleRepository } from "../infrastructure/role.repository";
import { EmployeePermissionProfileRepository } from "../infrastructure/employee-permission-profile.repository";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import "./handlers/invalidate-permission-cache.handler";

const roleRepository = new RoleRepository();
const employeePermissionProfileRepository = new EmployeePermissionProfileRepository();

export async function deleteRole(roleId: string): Promise<void> {
  const role = await runInTransaction(async () => {
    const existing = await roleRepository.findOneById(roleId);
    if (!existing) {
      throw new NotFoundException("Không tìm thấy vai trò", { metadata: { roleId } });
    }

    const affectedProfiles = await employeePermissionProfileRepository.findAllByRoleId(roleId);
    const affectedEmployeeIds = affectedProfiles.map((profile) => profile.employeeId);

    existing.markDeleted(affectedEmployeeIds);

    for (const profile of affectedProfiles) {
      profile.removeRoleReference(roleId);
      // eslint-disable-next-line no-await-in-loop
      await employeePermissionProfileRepository.updateById(profile.id, profile);
    }

    await roleRepository.delete(existing);

    return existing;
  });

  role.publishEvents(eventBus).catch(() => {});
}

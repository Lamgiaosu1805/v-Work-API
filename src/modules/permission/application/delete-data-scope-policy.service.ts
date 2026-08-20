import { NotFoundException } from "../../../core/exceptions/exceptions";
import { DataScopePolicyRepository } from "../infrastructure/data-scope-policy.repository";
import { PolicyInUseError } from "../domain/permission.errors";
import { eventBus } from "../../../core/events/event-bus";
import "./handlers/invalidate-permission-cache.handler";

const dataScopePolicyRepository = new DataScopePolicyRepository();

export async function deleteDataScopePolicy(id: string): Promise<void> {
  const policy = await dataScopePolicyRepository.findOneById(id);
  if (!policy) {
    throw new NotFoundException("Không tìm thấy Data Scope Policy", { metadata: { policyId: id } });
  }

  const referencingCount = await dataScopePolicyRepository.countRolesReferencing(policy.code);
  if (referencingCount > 0) {
    throw new PolicyInUseError(undefined, {
      metadata: { policyCode: policy.code, referencingCount }
    });
  }

  policy.markDeleted();

  await dataScopePolicyRepository.delete(policy);

  policy.publishEvents(eventBus).catch(() => {});
}

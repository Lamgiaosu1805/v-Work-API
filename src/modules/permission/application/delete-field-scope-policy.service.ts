import { NotFoundException } from "../../../core/exceptions/exceptions";
import { FieldScopePolicyRepository } from "../infrastructure/field-scope-policy.repository";
import { PolicyInUseError } from "../domain/permission.errors";
import { eventBus } from "../../../core/events/event-bus";
import "./handlers/invalidate-permission-cache.handler";

const fieldScopePolicyRepository = new FieldScopePolicyRepository();

export async function deleteFieldScopePolicy(id: string): Promise<void> {
  const policy = await fieldScopePolicyRepository.findOneById(id);
  if (!policy) {
    throw new NotFoundException("Không tìm thấy Field Scope Policy", {
      metadata: { policyId: id }
    });
  }

  const referencingCount = await fieldScopePolicyRepository.countRolesReferencing(policy.code);
  if (referencingCount > 0) {
    throw new PolicyInUseError(undefined, {
      metadata: { policyCode: policy.code, referencingCount }
    });
  }

  policy.markDeleted();

  await fieldScopePolicyRepository.delete(policy);

  policy.publishEvents(eventBus).catch(() => {});
}

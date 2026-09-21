import { NotFoundException } from "../../../core/exceptions/exceptions";
import { FieldScopePolicyEntity } from "../domain/field-scope-policy.entity";
import { FieldScopePolicyRepository } from "../infrastructure/field-scope-policy.repository";

const fieldScopePolicyRepository = new FieldScopePolicyRepository();

export async function getFieldScopePolicyById(id: string): Promise<FieldScopePolicyEntity> {
  const policy = await fieldScopePolicyRepository.findOneById(id);
  if (!policy) {
    throw new NotFoundException("Không tìm thấy Field Scope Policy", {
      metadata: { policyId: id }
    });
  }
  return policy;
}

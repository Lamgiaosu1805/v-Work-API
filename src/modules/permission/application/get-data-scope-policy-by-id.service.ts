import { NotFoundException } from "../../../core/exceptions/exceptions";
import { DataScopePolicyEntity } from "../domain/data-scope-policy.entity";
import { DataScopePolicyRepository } from "../infrastructure/data-scope-policy.repository";

const dataScopePolicyRepository = new DataScopePolicyRepository();

export async function getDataScopePolicyById(id: string): Promise<DataScopePolicyEntity> {
  const policy = await dataScopePolicyRepository.findOneById(id);
  if (!policy) {
    throw new NotFoundException("Không tìm thấy Data Scope Policy", { metadata: { policyId: id } });
  }
  return policy;
}

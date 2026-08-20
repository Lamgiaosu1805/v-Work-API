import { NotFoundException } from "../../../core/exceptions/exceptions";
import { DataScopePolicyEntity } from "../domain/data-scope-policy.entity";
import { DataScopePolicyRepository } from "../infrastructure/data-scope-policy.repository";
import { resolveAttributeWhitelist } from "./resolve-attribute-whitelist";
import { ConditionTreeProps } from "../domain/value-objects/condition-tree.vo";
import { eventBus } from "../../../core/events/event-bus";
import "./handlers/invalidate-permission-cache.handler";

const dataScopePolicyRepository = new DataScopePolicyRepository();

export interface UpdateDataScopePolicyInput {
  label?: string;
  conditionTree?: ConditionTreeProps | null;
}

export async function updateDataScopePolicy(
  id: string,
  input: UpdateDataScopePolicyInput
): Promise<DataScopePolicyEntity> {
  const policy = await dataScopePolicyRepository.findOneById(id);
  if (!policy) {
    throw new NotFoundException("Không tìm thấy Data Scope Policy", { metadata: { policyId: id } });
  }

  if (input.label !== undefined) {
    policy.rename(input.label);
  }

  if (input.conditionTree !== undefined) {
    const whitelist = await resolveAttributeWhitelist(policy.entityName);
    policy.updateCondition(input.conditionTree, whitelist);
  }

  await dataScopePolicyRepository.updateById(id, policy);

  policy.publishEvents(eventBus).catch(() => {});

  return policy;
}

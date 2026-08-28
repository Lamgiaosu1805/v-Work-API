import { NotFoundException } from "../../../core/exceptions/exceptions";
import { FieldScopePolicyEntity } from "../domain/field-scope-policy.entity";
import { FieldScopePolicyRepository } from "../infrastructure/field-scope-policy.repository";
import { resolveFieldAttributeWhitelist } from "./resolve-attribute-whitelist";
import { ConditionTreeProps } from "../domain/value-objects/condition-tree.vo";
import { eventBus } from "../../../core/events/event-bus";
import "./handlers/invalidate-permission-cache.handler";

const fieldScopePolicyRepository = new FieldScopePolicyRepository();

export interface UpdateFieldScopePolicyInput {
  label?: string;
  fields?: string[];
  conditionTree?: ConditionTreeProps | null;
}

export async function updateFieldScopePolicy(
  id: string,
  input: UpdateFieldScopePolicyInput
): Promise<FieldScopePolicyEntity> {
  const policy = await fieldScopePolicyRepository.findOneById(id);
  if (!policy) {
    throw new NotFoundException("Không tìm thấy Field Scope Policy", {
      metadata: { policyId: id }
    });
  }

  if (input.label !== undefined) {
    policy.rename(input.label);
  }

  if (input.fields !== undefined || input.conditionTree !== undefined) {
    const whitelist = await resolveFieldAttributeWhitelist(policy.entityName);
    const nextFields = input.fields ?? policy.fields;
    const nextConditionTree =
      input.conditionTree !== undefined
        ? input.conditionTree
        : (policy.conditionTree?.unpack() ?? null);
    policy.update(nextFields, nextConditionTree, whitelist);
  }

  await fieldScopePolicyRepository.updateById(id, policy);

  policy.publishEvents(eventBus).catch(() => {});

  return policy;
}

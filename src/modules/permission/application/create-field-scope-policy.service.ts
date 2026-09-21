import mongoose from "mongoose";
import { FieldScopePolicyEntity } from "../domain/field-scope-policy.entity";
import { FieldScopePolicyRepository } from "../infrastructure/field-scope-policy.repository";
import { resolveFieldAttributeWhitelist } from "./resolve-attribute-whitelist";
import { DuplicatePolicyCodeError } from "../domain/permission.errors";
import { ConditionTreeProps } from "../domain/value-objects/condition-tree.vo";

const fieldScopePolicyRepository = new FieldScopePolicyRepository();

export interface CreateFieldScopePolicyInput {
  code: string;
  entity: string;
  label: string;
  fields: string[];
  conditionTree?: ConditionTreeProps | null;
}

export async function createFieldScopePolicy(
  input: CreateFieldScopePolicyInput
): Promise<FieldScopePolicyEntity> {
  const existing = await fieldScopePolicyRepository.findByCode(input.code);
  if (existing) {
    throw new DuplicatePolicyCodeError(undefined, { metadata: { code: input.code } });
  }

  const whitelist = await resolveFieldAttributeWhitelist(input.entity);

  const id = new mongoose.Types.ObjectId().toString();
  const policy = FieldScopePolicyEntity.create({ id, ...input }, whitelist);

  try {
    await fieldScopePolicyRepository.insert(policy);
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new DuplicatePolicyCodeError(undefined, { metadata: { code: input.code } });
    }
    throw error;
  }

  return policy;
}

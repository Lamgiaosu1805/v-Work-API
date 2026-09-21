import mongoose from "mongoose";
import { DataScopePolicyEntity } from "../domain/data-scope-policy.entity";
import { DataScopePolicyRepository } from "../infrastructure/data-scope-policy.repository";
import { resolveAttributeWhitelist } from "./resolve-attribute-whitelist";
import { DuplicatePolicyCodeError } from "../domain/permission.errors";
import { ConditionTreeProps } from "../domain/value-objects/condition-tree.vo";

const dataScopePolicyRepository = new DataScopePolicyRepository();

export interface CreateDataScopePolicyInput {
  code: string;
  entity: string;
  label: string;
  conditionTree: ConditionTreeProps | null;
}

export async function createDataScopePolicy(
  input: CreateDataScopePolicyInput
): Promise<DataScopePolicyEntity> {
  const existing = await dataScopePolicyRepository.findByCode(input.code);
  if (existing) {
    throw new DuplicatePolicyCodeError(undefined, { metadata: { code: input.code } });
  }

  const whitelist = await resolveAttributeWhitelist(input.entity);

  const id = new mongoose.Types.ObjectId().toString();
  const policy = DataScopePolicyEntity.create({ id, ...input }, whitelist);

  try {
    await dataScopePolicyRepository.insert(policy);
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new DuplicatePolicyCodeError(undefined, { metadata: { code: input.code } });
    }
    throw error;
  }

  return policy;
}

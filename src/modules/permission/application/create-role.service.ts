import mongoose from "mongoose";
import { RoleEntity } from "../domain/role.entity";
import { RoleRepository } from "../infrastructure/role.repository";
import { DuplicateRoleCodeError } from "../domain/permission.errors";

const roleRepository = new RoleRepository();

export interface CreateRoleInput {
  name: string;
  code: string;
  description?: string;
}

export async function createRole(input: CreateRoleInput): Promise<RoleEntity> {
  const existing = await roleRepository.findByCode(input.code);
  if (existing) {
    throw new DuplicateRoleCodeError(undefined, { metadata: { code: input.code } });
  }

  const id = new mongoose.Types.ObjectId().toString();
  const role = RoleEntity.create({ id, ...input });

  try {
    await roleRepository.insert(role);
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new DuplicateRoleCodeError(undefined, { metadata: { code: input.code } });
    }
    throw error;
  }

  return role;
}

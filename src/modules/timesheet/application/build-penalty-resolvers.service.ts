import { PenaltyPolicyRepository } from "../infrastructure/penalty-policy.repository";
import { PenaltyResolver } from "../domain/types";

const penaltyPolicyRepository = new PenaltyPolicyRepository();

export async function buildLatePenaltyResolver(): Promise<PenaltyResolver> {
  return penaltyPolicyRepository.buildLatePenaltyResolver();
}

export async function buildEarlyPenaltyResolver(): Promise<PenaltyResolver> {
  return penaltyPolicyRepository.buildEarlyPenaltyResolver();
}

export async function buildForgotPenaltyResolver(): Promise<PenaltyResolver> {
  return penaltyPolicyRepository.buildForgotPenaltyResolver();
}

import { resolveRequestApprovalCandidates } from "../../../core/authorization/resolve-request-approval-candidates";
import { ReviewerProfile } from "./types";

export interface ApprovalCandidate extends ReviewerProfile {
  accountId: unknown;
}

export async function getApprovalChain(employeeUserInfoId: unknown): Promise<ApprovalCandidate[]> {
  const candidates = await resolveRequestApprovalCandidates(String(employeeUserInfoId));
  return candidates.map((candidate) => ({
    userInfoId: candidate.userInfoId,
    accountId: candidate.accountId,
    full_name: candidate.full_name,
    position_name: candidate.position_name,
    department_name: candidate.department_name
  }));
}

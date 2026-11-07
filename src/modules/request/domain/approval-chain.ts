import { resolveRequestApprovalCandidates } from "../../../core/authorization/resolve-request-approval-candidates";
import { ReviewerProfile } from "./types";

export type ApprovalSource = "direct_manager" | "branch_leader" | "permission";

export interface ApprovalCandidate extends ReviewerProfile {
  accountId: unknown;
  source?: ApprovalSource;
}

// Danh sách gợi ý người duyệt: quản lý theo sơ đồ (direct_manager -> department.manager) trước, rồi
// người được gán quyền request.review bao trùm nhân viên. Không phải điều kiện bắt buộc để duyệt.
export async function getApprovalChain(employeeUserInfoId: unknown): Promise<ApprovalCandidate[]> {
  const candidates = await resolveRequestApprovalCandidates(String(employeeUserInfoId));
  return candidates.map((candidate) => ({
    userInfoId: candidate.userInfoId,
    accountId: candidate.accountId,
    full_name: candidate.full_name,
    position_name: candidate.position_name,
    department_name: candidate.department_name,
    source: candidate.source
  }));
}

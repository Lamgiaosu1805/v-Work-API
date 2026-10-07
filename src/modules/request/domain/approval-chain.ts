import { resolveRequestApprovalCandidates } from "../../../core/authorization/resolve-request-approval-candidates";
import { ReviewerProfile } from "./types";

export type ApprovalSource = "direct_manager" | "branch_leader" | "admin";

export interface ApprovalCandidate extends ReviewerProfile {
  accountId: unknown;
  source?: ApprovalSource;
}

// Chuỗi duyệt chỉ lấy từ cấu hình quản lý mới: direct_manager -> department.manager.
// Quyền cũ hoặc việc cùng phòng ban không tự biến một người thành cấp duyệt.
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

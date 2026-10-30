import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { AssignmentInput } from "../domain/ticket.entity";
import { TicketForbiddenError } from "../domain/ticket.errors";
import { TicketActor } from "../domain/types";
import { TicketDirectory } from "./ports";

// Ai được giao việc cho ai (docs/TICKET-MODULE-PLAN.md mục 2 "Giao việc theo cấp"):
// - Ban lãnh đạo (ticket.assign_department): giao cho phòng ban, hoặc người cụ thể bất kỳ.
// - Trưởng bộ phận (ticket.assign_member): chỉ giao cho người cụ thể TRONG phòng mình (kể cả phòng con).
//   Muốn nhờ phòng khác thì tạo ticket để bên đó tự nhận.
export async function authorizeAssignment(
  directory: TicketDirectory,
  actor: TicketActor,
  input: AssignmentInput | null | undefined
): Promise<void> {
  if (!input || input.mode === "none") return;

  if (input.mode === "department") {
    if (!actor.canAssignDepartment) {
      throw new TicketForbiddenError("Chỉ ban lãnh đạo mới giao việc cho cả phòng ban");
    }
    const [department] = await directory.getDepartments([String(input.departmentId)]);
    if (!department) throw new ArgumentInvalidException("Phòng ban không tồn tại");
    return;
  }

  const memberIds = [...new Set((input.memberIds ?? []).map(String))];
  if (!memberIds.length) {
    throw new ArgumentInvalidException("Giao cho người cụ thể phải chọn ít nhất một người");
  }
  if (!actor.canAssignDepartment && !actor.canAssignMember) {
    throw new TicketForbiddenError("Bạn không có quyền giao việc cho người khác");
  }

  const found = await directory.getEmployees(memberIds);
  if (found.length !== memberIds.length) {
    throw new ArgumentInvalidException("Có người được giao không tồn tại");
  }

  if (actor.canAssignDepartment) {
    await assertCanHandle(directory, found, memberIds);
    return;
  }
  const ownTree = new Set(await directory.getOwnDepartmentTreeEmployeeIds(actor.employeeId));
  const outside = memberIds.filter((id) => !ownTree.has(id));
  if (outside.length) {
    throw new TicketForbiddenError(
      "Trưởng bộ phận chỉ giao việc cho người trong phòng mình. Để nhờ phòng khác, hãy tạo ticket mới"
    );
  }
  await assertCanHandle(directory, found, memberIds);
}

// Người được giao / mời phối hợp phải có quyền xử lý ticket (ticket.handle): nếu không họ nhận thông báo "được giao"
// nhưng nhận / trả lại / báo xong đều bị 403 và ticket kẹt. Báo ngay lúc giao, kèm tên người thiếu quyền.
export async function assertCanHandle(
  directory: TicketDirectory,
  employees: Array<{ id: string; fullName: string }>,
  employeeIds: string[]
): Promise<void> {
  const allowed = new Set(
    await directory.filterEmployeesWithPermission(employeeIds, "ticket.handle")
  );
  const lacking = employees.filter((employee) => !allowed.has(employee.id));
  if (lacking.length) {
    throw new ArgumentInvalidException(
      `Chưa có quyền xử lý ticket (cần gán role người xử lý ticket): ${lacking.map((employee) => employee.fullName).join(", ")}`
    );
  }
}

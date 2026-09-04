import { Request, Response } from "express";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { getSipCredentials } from "../application/get-sip-credentials.service";
import { listCrmSaleEmployees } from "../../../workflows/list-crm-sale-employees.workflow";
import { inviteCrmSaleEmployee } from "../../../workflows/invite-crm-sale-employee.workflow";
import { changeCrmSaleRole } from "../../../workflows/change-crm-sale-role.workflow";
import { removeCrmSaleEmployee } from "../../../workflows/remove-crm-sale-employee.workflow";
import { transferCrmSaleEmployee } from "../../../workflows/transfer-crm-sale-employee.workflow";
import { configureCrmSaleSipPassword } from "../../../workflows/configure-crm-sale-sip-password.workflow";
import { CRM_SALE_ROLE_CODES, CrmSaleRoleCode } from "../../../workflows/crm-sale-roles.constants";
import { assignExtensionOutboundHotline } from "../application/assign-extension-outbound-hotline.service";

function assertValidCrmSaleRoleCode(roleCode: unknown): asserts roleCode is CrmSaleRoleCode {
  if (!CRM_SALE_ROLE_CODES.includes(roleCode as CrmSaleRoleCode)) {
    throw new ArgumentInvalidException("roleCode phải là CRM_SALE hoặc CRM_SALE_TEAM_LEAD");
  }
}

export const crmSaleAdminHttpController = {
  async getCrmSaleEmployees(req: Request, res: Response) {
    const data = await listCrmSaleEmployees();
    return res.status(200).json({ message: "OK", data });
  },

  async inviteCrmSaleEmployee(req: Request, res: Response) {
    const { roleCode } = req.body;
    assertValidCrmSaleRoleCode(roleCode);
    const data = await inviteCrmSaleEmployee(req.params.employeeId, roleCode);
    return res.status(200).json({ message: "Mời nhân viên thành công", data });
  },

  async changeCrmSaleRole(req: Request, res: Response) {
    const { roleCode } = req.body;
    assertValidCrmSaleRoleCode(roleCode);
    await changeCrmSaleRole(req.params.employeeId, roleCode);
    return res.status(200).json({ message: "Cập nhật phân quyền thành công" });
  },

  async removeCrmSaleEmployee(req: Request, res: Response) {
    await removeCrmSaleEmployee(req.params.employeeId);
    return res.status(200).json({ message: "Gỡ nhân viên thành công" });
  },

  async transferCrmSaleEmployee(req: Request, res: Response) {
    const { targetEmployeeId } = req.body;
    if (!targetEmployeeId || typeof targetEmployeeId !== "string") {
      throw new ArgumentInvalidException("targetEmployeeId là bắt buộc");
    }
    const data = await transferCrmSaleEmployee(req.params.employeeId, targetEmployeeId);
    return res.status(200).json({
      message: "Đã gửi yêu cầu chuyển giao — kết quả sẽ báo qua webhook khi Omicall xử lý xong",
      data
    });
  },

  async configureCrmSaleSipPassword(req: Request, res: Response) {
    const data = await configureCrmSaleSipPassword(req.params.employeeId);
    return res.status(200).json({ message: "Cập nhật mật khẩu SIP thành công", data });
  },

  async syncCrmSaleSipCredentials(req: Request, res: Response) {
    const data = await getSipCredentials(req.params.employeeId, true);
    return res.status(200).json({ message: "Đồng bộ SIP thành công", data });
  },

  async assignExtensionOutboundHotline(req: Request, res: Response) {
    const { hotlineNumber } = req.body;
    if (!hotlineNumber || typeof hotlineNumber !== "string") {
      throw new ArgumentInvalidException("hotlineNumber là bắt buộc");
    }
    await assignExtensionOutboundHotline(req.params.employeeId, hotlineNumber);
    return res.status(200).json({ message: "Đã gán đầu số gọi ra" });
  }
};

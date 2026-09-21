import { Request, Response } from "express";
import { ForbiddenException } from "../../../core/exceptions/exceptions";
import { listRoles } from "../application/list-roles.service";
import { getRoleById } from "../application/get-role-by-id.service";
import { createRole } from "../application/create-role.service";
import { updateRole } from "../application/update-role.service";
import { deleteRole } from "../application/delete-role.service";
import { getRoleDeletionImpact } from "../application/get-role-deletion-impact.service";
import { listEmployeesForPermission } from "../application/list-employees-for-permission.service";
import { getEmployeePermissionProfile } from "../application/get-employee-permission-profile.service";
import { updateEmployeePermission } from "../application/update-employee-permission.service";
import { listDataScopePolicies } from "../application/list-data-scope-policies.service";
import { getDataScopePolicyById } from "../application/get-data-scope-policy-by-id.service";
import { createDataScopePolicy } from "../application/create-data-scope-policy.service";
import { updateDataScopePolicy } from "../application/update-data-scope-policy.service";
import { deleteDataScopePolicy } from "../application/delete-data-scope-policy.service";
import { listFieldScopePolicies } from "../application/list-field-scope-policies.service";
import { getFieldScopePolicyById } from "../application/get-field-scope-policy-by-id.service";
import { createFieldScopePolicy } from "../application/create-field-scope-policy.service";
import { updateFieldScopePolicy } from "../application/update-field-scope-policy.service";
import { deleteFieldScopePolicy } from "../application/delete-field-scope-policy.service";
import { getAttributeCatalog } from "../application/get-attribute-catalog.service";
import { listPermissionCatalog } from "../application/list-permission-catalog.service";
import { getMyEffectivePermissions } from "../application/get-my-effective-permissions.service";
import { updatePermissionCatalogWhitelists } from "../application/update-permission-catalog-whitelists.service";
import { resolveEmployeeId } from "../../../core/authorization/resolve-employee-id";

export const permissionHttpController = {
  async listRoles(req: Request, res: Response) {
    const result = await listRoles(req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getRoleById(req: Request, res: Response) {
    const role = await getRoleById(req.params.id);
    return res.status(200).json({ message: "OK", data: role.getProps() });
  },

  async createRole(req: Request, res: Response) {
    const { name, code, description } = req.body;
    const role = await createRole({ name, code, description });
    return res.status(201).json({ message: "Tạo vai trò thành công", data: role.getProps() });
  },

  async updateRole(req: Request, res: Response) {
    const { name, description, grants } = req.body;
    const role = await updateRole(req.params.id, { name, description, grants });
    return res.status(200).json({ message: "Cập nhật vai trò thành công", data: role.getProps() });
  },

  async deleteRole(req: Request, res: Response) {
    await deleteRole(req.params.id);
    return res.status(200).json({ message: "Xóa vai trò thành công" });
  },

  async getRoleDeletionImpact(req: Request, res: Response) {
    const impact = await getRoleDeletionImpact(req.params.id);
    return res.status(200).json({ message: "OK", data: impact });
  },

  async listEmployeesForPermission(req: Request, res: Response) {
    const result = await listEmployeesForPermission(req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getEmployeePermissionProfile(req: Request, res: Response) {
    const profile = await getEmployeePermissionProfile(req.params.employeeId);
    return res.status(200).json({ message: "OK", data: profile });
  },

  async updateEmployeePermission(req: Request, res: Response) {
    const { roleIds, overrides } = req.body;
    const profile = await updateEmployeePermission(req.params.employeeId, { roleIds, overrides });
    return res
      .status(200)
      .json({ message: "Cập nhật phân quyền thành công", data: profile.getProps() });
  },

  async listDataScopePolicies(req: Request, res: Response) {
    const result = await listDataScopePolicies(req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getDataScopePolicyById(req: Request, res: Response) {
    const policy = await getDataScopePolicyById(req.params.id);
    return res.status(200).json({ message: "OK", data: policy.getProps() });
  },

  async createDataScopePolicy(req: Request, res: Response) {
    const { code, entity, label, conditionTree } = req.body;
    const policy = await createDataScopePolicy({ code, entity, label, conditionTree });
    return res
      .status(201)
      .json({ message: "Tạo Data Scope Policy thành công", data: policy.getProps() });
  },

  async updateDataScopePolicy(req: Request, res: Response) {
    const { label, conditionTree } = req.body;
    const policy = await updateDataScopePolicy(req.params.id, { label, conditionTree });
    return res
      .status(200)
      .json({ message: "Cập nhật Data Scope Policy thành công", data: policy.getProps() });
  },

  async deleteDataScopePolicy(req: Request, res: Response) {
    await deleteDataScopePolicy(req.params.id);
    return res.status(200).json({ message: "Xóa Data Scope Policy thành công" });
  },

  async listFieldScopePolicies(req: Request, res: Response) {
    const result = await listFieldScopePolicies(req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getFieldScopePolicyById(req: Request, res: Response) {
    const policy = await getFieldScopePolicyById(req.params.id);
    return res.status(200).json({ message: "OK", data: policy.getProps() });
  },

  async createFieldScopePolicy(req: Request, res: Response) {
    const { code, entity, label, fields, conditionTree } = req.body;
    const policy = await createFieldScopePolicy({ code, entity, label, fields, conditionTree });
    return res
      .status(201)
      .json({ message: "Tạo Field Scope Policy thành công", data: policy.getProps() });
  },

  async updateFieldScopePolicy(req: Request, res: Response) {
    const { label, fields, conditionTree } = req.body;
    const policy = await updateFieldScopePolicy(req.params.id, { label, fields, conditionTree });
    return res
      .status(200)
      .json({ message: "Cập nhật Field Scope Policy thành công", data: policy.getProps() });
  },

  async deleteFieldScopePolicy(req: Request, res: Response) {
    await deleteFieldScopePolicy(req.params.id);
    return res.status(200).json({ message: "Xóa Field Scope Policy thành công" });
  },

  async getAttributeCatalog(req: Request, res: Response) {
    const catalog = await getAttributeCatalog(String(req.query.entity ?? ""));
    return res.status(200).json({ message: "OK", data: catalog });
  },

  async listPermissionCatalog(_req: Request, res: Response) {
    const catalog = await listPermissionCatalog();
    return res.status(200).json({ message: "OK", data: catalog });
  },

  async updatePermissionCatalogWhitelists(req: Request, res: Response) {
    const { validDataScopePolicies, validFieldScopePolicies } = req.body;
    const permission = await updatePermissionCatalogWhitelists(req.params.code, {
      validDataScopePolicies,
      validFieldScopePolicies
    });
    return res
      .status(200)
      .json({ message: "Cập nhật phạm vi cho phép thành công", data: permission });
  },

  async getMyEffectivePermissions(req: Request, res: Response) {
    if (!req.account?._id) {
      throw new ForbiddenException("Chưa đăng nhập");
    }
    const employeeId = await resolveEmployeeId(req.account._id);
    const permissions = await getMyEffectivePermissions(employeeId);
    return res.status(200).json({ message: "OK", data: { permissions } });
  }
};

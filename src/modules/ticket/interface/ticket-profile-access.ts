import { Request } from "express";
import AppModel from "../../../models/AppModel";
import CustomerModel from "../../../models/CustomerModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { resolveEmployeeScopeFilter } from "../../../core/authorization/resolve-employee-scope-filter";
import type { Ability } from "../../permission";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { canAccessCustomer } = require("../../../helpers/crmScope");

// Link sang hồ sơ khách (CRM) / nhân viên (HRM) ở chi tiết ticket phải dẫn tới đúng nơi VÀ người xem thật sự mở được:
// quyền khách / nhân viên có thêm PHẠM VI dữ liệu (vd Sale chỉ thấy khách của mình, người chỉ xem được nhân viên phòng
// mình) nên "có quyền xem" chưa đủ — kiểm tra theo từng hồ sơ ở đây, cùng quy tắc với chính trang đích.

// App có trang chi tiết đầy đủ trong CRM (lịch sử giao dịch, khoản đầu tư… lấy từ hệ thống TIKLUY). App khác (VNFITE)
// chưa có nguồn dữ liệu chi tiết nên chỉ dẫn tới danh sách khách của app đó.
const CRM_DETAIL_APP_CODES = ["tikluy"];

export type CustomerProfileTarget = "detail" | "list" | null;

async function findCrmCustomer(customer: {
  customerId?: string;
  externalId?: string;
  appCode?: string;
}) {
  if (customer.customerId) {
    const byId = await CustomerModel.findOne({ _id: customer.customerId, isDeleted: false });
    if (byId) return byId;
  }
  if (!customer.externalId) return null;
  const filter: Record<string, unknown> = { external_id: customer.externalId, isDeleted: false };
  if (customer.appCode) {
    const app = await AppModel.findOne({ code: String(customer.appCode).toLowerCase() }).lean();
    if (app) filter.app_id = (app as { _id: unknown })._id;
  }
  return CustomerModel.findOne(filter);
}

// Trả về nơi link dẫn tới: "detail" (trang chi tiết khách), "list" (danh sách khách của app, tìm theo SĐT),
// hoặc null (không có hồ sơ CRM / người xem không có quyền với khách này).
export async function customerProfileTarget(
  ability: Ability | undefined,
  customer: { customerId?: string; externalId?: string; appCode?: string } | null
): Promise<CustomerProfileTarget> {
  if (!ability || !customer) return null;
  const doc = await findCrmCustomer(customer);
  if (!doc) return null;
  if (!(await canAccessCustomer(ability, doc, "customer.view"))) return null;
  const app = await AppModel.findById(doc.app_id).select("code").lean();
  const code = String((app as { code?: string } | null)?.code ?? "").toLowerCase();
  return CRM_DETAIL_APP_CODES.includes(code) ? "detail" : "list";
}

// Người xem mở được hồ sơ nhân viên này ở HRM không (quyền employee.view + phạm vi dữ liệu).
export async function canOpenEmployeeProfile(
  ability: Ability | undefined,
  employeeId: string
): Promise<boolean> {
  if (!ability || !ability.can("employee.view", "Employee")) return false;
  const scopeFilter = await resolveEmployeeScopeFilter(ability, "employee.view");
  if (Object.keys(scopeFilter).length === 0) return true;
  return Boolean(
    await UserInfoModel.exists({ $and: [{ _id: employeeId, isDeleted: false }, scopeFilter] })
  );
}

// Bổ sung `customerAccess.profileTarget` / `canOpenProfile` và `relatedEmployee.canOpenProfile` vào chi tiết ticket.
export async function withProfileAccess<T extends Record<string, any>>(
  req: Request,
  detail: T
): Promise<T> {
  if (detail.accessLevel !== "full") return detail;
  const ability = (req as unknown as { permissionAbility?: Ability }).permissionAbility;

  const result: Record<string, any> = { ...detail };
  if (detail.customer && detail.customerAccess) {
    const target = detail.customerAccess.canOpenProfile
      ? await customerProfileTarget(ability, detail.customer)
      : null;
    result.customerAccess = {
      ...detail.customerAccess,
      canOpenProfile: target !== null,
      profileTarget: target
    };
  }
  if (detail.relatedEmployee?.id) {
    result.relatedEmployee = {
      ...detail.relatedEmployee,
      canOpenProfile: await canOpenEmployeeProfile(ability, String(detail.relatedEmployee.id))
    };
  }
  return result as T;
}

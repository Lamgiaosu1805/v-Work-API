import { Request, Response } from "express";
import { resolveEmployeeId } from "../../../core/authorization/resolve-employee-id";
import {
  ArgumentInvalidException,
  ForbiddenException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { canOnSubject } from "../../permission";
import CustomerModel from "../../../models/CustomerModel";
import {
  listMyCareQueue,
  listAssignments,
  listCustomerAssignmentHistory,
  listPool,
  getCareDashboard
} from "../application/customer-care-queries.service";
import {
  requireCarePolicy,
  setSaleAllocationStatus,
  setSaleCaps
} from "../application/allocation.service";
import { getCarePolicyView, updateCarePolicy } from "../application/care-policy.service";
import {
  manuallyAssignCustomer,
  manuallyRevokeCustomer,
  returnNurturingCustomerToPool,
  excludeCustomer
} from "../../../workflows/manage-customer-care.workflow";
import { listSaleAllocationOverview } from "../../../workflows/list-sale-allocation-overview.workflow";

const DEFAULT_APP_CODE = "tikluy";
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ArgumentInvalidException(`${field} không hợp lệ`);
  return date;
}

function appCodeOf(req: Request): string {
  return String(req.query.appCode || req.body?.appCode || DEFAULT_APP_CODE);
}

export const customerCareHttpController = {
  async getMyQueue(req: Request, res: Response) {
    const saleId = await resolveEmployeeId(req.account!._id);
    const result = await listMyCareQueue(saleId, new Date());
    return res.status(200).json({ message: "OK", ...result });
  },

  async getCustomerHistory(req: Request, res: Response) {
    const customer = await CustomerModel.findOne({ _id: req.params.id, isDeleted: false })
      .select("referred_by")
      .lean();
    if (!customer) throw new NotFoundException("Không tìm thấy khách hàng");
    const ability = req.permissionAbility!;
    const allowed =
      canOnSubject(ability, "customer_care.view", "Customer", customer) ||
      canOnSubject(ability, "customer_care.manage", "Customer", customer);
    if (!allowed) throw new ForbiddenException("Bạn không có quyền xem khách hàng này");
    const data = await listCustomerAssignmentHistory(req.params.id);
    return res.status(200).json({ message: "OK", data });
  },

  async getAssignments(req: Request, res: Response) {
    const result = await listAssignments(req.permissionAbility!, {
      appCode: req.query.appCode as string | undefined,
      saleId: req.query.saleId as string | undefined,
      status: req.query.status as "active" | "ended" | undefined,
      endedReason: req.query.endedReason as string | undefined,
      breachedOnly: req.query.breachedOnly === "true",
      from: parseDate(req.query.from, "from"),
      to: parseDate(req.query.to, "to"),
      page: req.query.page,
      limit: req.query.limit
    });
    return res.status(200).json({ message: "OK", ...result });
  },

  async getPool(req: Request, res: Response) {
    const result = await listPool(req.permissionAbility!, {
      appCode: req.query.appCode as string | undefined,
      poolStatus: req.query.poolStatus as "in_pool" | "nurturing" | "excluded" | undefined,
      priorityClass: req.query.priorityClass as "A" | "B" | "C" | undefined,
      page: req.query.page,
      limit: req.query.limit
    });
    return res.status(200).json({ message: "OK", ...result });
  },

  async getDashboard(req: Request, res: Response) {
    const now = new Date();
    const to = parseDate(req.query.to, "to") ?? now;
    const from = parseDate(req.query.from, "from") ?? new Date(to.getTime() - 7 * DAY_MS);
    const data = await getCareDashboard(req.permissionAbility!, {
      appCode: req.query.appCode as string | undefined,
      from,
      to,
      now
    });
    return res.status(200).json({ message: "OK", data, range: { from, to } });
  },

  async getSales(req: Request, res: Response) {
    const data = await listSaleAllocationOverview(req.permissionAbility!, appCodeOf(req));
    return res.status(200).json({ message: "OK", data });
  },

  async updateSaleAllocation(req: Request, res: Response) {
    const { saleId } = req.params;
    if (
      !canOnSubject(req.permissionAbility!, "customer_care.manage", "Customer", {
        referred_by: saleId
      })
    ) {
      throw new ForbiddenException("Bạn không có quyền điều chỉnh nhận khách của Sale này");
    }
    const policy = await requireCarePolicy(appCodeOf(req));
    const { status, reason, until, capNewPerDay, capTotal } = req.body ?? {};
    let profile;
    if (status) {
      profile = await setSaleAllocationStatus({
        saleId,
        status,
        reason: reason ?? null,
        until: parseDate(until, "until") ?? null,
        by: String(req.account!._id),
        at: new Date(),
        defaultRank: policy.defaultRank
      });
    }
    if (capNewPerDay !== undefined || capTotal !== undefined) {
      const toCap = (v: unknown) => (v === null || v === "" ? null : Number(v));
      profile = await setSaleCaps({
        saleId,
        capNewPerDay:
          capNewPerDay === undefined
            ? (profile?.getProps().capNewPerDay ?? null)
            : toCap(capNewPerDay),
        capTotal: capTotal === undefined ? (profile?.getProps().capTotal ?? null) : toCap(capTotal),
        defaultRank: policy.defaultRank
      });
    }
    if (!profile) throw new ArgumentInvalidException("Không có thay đổi nào");
    return res
      .status(200)
      .json({ message: "Đã cập nhật nhận khách của Sale", data: profile.getProps() });
  },

  async assignCustomer(req: Request, res: Response) {
    const saleId = req.body?.sale_id;
    if (!saleId) throw new ArgumentInvalidException("Thiếu sale_id");
    const data = await manuallyAssignCustomer({
      ability: req.permissionAbility!,
      actorAccountId: String(req.account!._id),
      customerId: req.params.id,
      saleId: String(saleId),
      reason: req.body?.reason ?? null
    });
    return res.status(200).json({ message: "Đã giao khách cho Sale", data });
  },

  async revokeCustomer(req: Request, res: Response) {
    const data = await manuallyRevokeCustomer({
      ability: req.permissionAbility!,
      actorAccountId: String(req.account!._id),
      customerId: req.params.id,
      reason: String(req.body?.reason ?? "")
    });
    return res.status(200).json({ message: "Đã thu hồi khách", data });
  },

  async returnToPool(req: Request, res: Response) {
    await returnNurturingCustomerToPool({
      customerId: req.params.id,
      reason: req.body?.reason ?? null
    });
    return res.status(200).json({ message: "Đã đưa khách về kho chung" });
  },

  async excludeFromPool(req: Request, res: Response) {
    await excludeCustomer({ customerId: req.params.id, reason: String(req.body?.reason ?? "") });
    return res.status(200).json({ message: "Đã loại khách khỏi kho chung" });
  },

  async getPolicy(req: Request, res: Response) {
    const data = await getCarePolicyView(appCodeOf(req));
    return res.status(200).json({ message: "OK", data });
  },

  async updatePolicy(req: Request, res: Response) {
    const data = await updateCarePolicy(
      req.params.appCode,
      req.body ?? {},
      String(req.account!._id)
    );
    return res.status(200).json({ message: "Đã cập nhật chính sách chăm sóc khách", data });
  }
};

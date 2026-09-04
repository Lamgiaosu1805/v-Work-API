import { Request, Response } from "express";
import { resolveEmployeeId } from "../../../core/authorization/resolve-employee-id";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { getSipCredentials } from "../application/get-sip-credentials.service";
import { updateSaleRelationshipStatus } from "../application/update-sale-relationship-status.service";
import {
  listCallHistory,
  listCallHistorySaleOptions
} from "../application/list-call-history.service";
import {
  listCustomersToCall,
  ListCustomersToCallFilters
} from "../application/list-customers-to-call.service";
import { reconcileCallHistory } from "../application/reconcile-call-history.service";
import { updateCallLogNote } from "../application/update-call-log-note.service";
import { recordCallAttempt } from "../application/record-call-attempt.service";
import { CustomerSaleRelationshipStatus } from "../domain/customer-sale-relationship.entity";

function parseCsvParam(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return value.split(",").filter(Boolean);
}

function parseCallCountParam(value: unknown): (number | "gt3")[] | undefined {
  const parts = parseCsvParam(value);
  if (!parts) return undefined;
  return parts.map((part) => (part === "gt3" ? "gt3" : Number(part)));
}

export const customerCallHttpController = {
  async getSipCredentials(req: Request, res: Response) {
    const employeeId = await resolveEmployeeId(req.account!._id);
    const forceRefresh = req.query.refresh === "true";
    const credentials = await getSipCredentials(employeeId, forceRefresh);
    return res.status(200).json({ message: "OK", data: credentials });
  },

  async updateRelationshipStatus(req: Request, res: Response) {
    const employeeId = await resolveEmployeeId(req.account!._id);
    const entity = await updateSaleRelationshipStatus(
      req.params.id,
      employeeId,
      req.body.status as CustomerSaleRelationshipStatus,
      req.account!._id
    );
    return res.status(200).json({ message: "Cập nhật thành công", data: entity.getProps() });
  },

  async getCustomersToCall(req: Request, res: Response) {
    const { appCode, status, relationshipStatus, callCount, search, page, limit } = req.query;

    const result = await listCustomersToCall(req.permissionAbility!, {
      appCode: appCode as string | undefined,
      status: parseCsvParam(status) as ListCustomersToCallFilters["status"],
      relationshipStatus: parseCsvParam(relationshipStatus),
      callCount: parseCallCountParam(callCount),
      search: search as string | undefined,
      page,
      limit
    });
    return res.status(200).json({ message: "OK", ...result });
  },

  async getCallHistory(req: Request, res: Response) {
    const result = await listCallHistory(req.permissionAbility!, req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getCallHistorySaleOptions(req: Request, res: Response) {
    const data = await listCallHistorySaleOptions(req.permissionAbility!);
    return res.status(200).json({ message: "OK", data });
  },

  async reconcileCallHistory(req: Request, res: Response) {
    const fromDate = new Date(req.query.fromDate as string);
    const toDate = new Date(req.query.toDate as string);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new ArgumentInvalidException("fromDate/toDate không hợp lệ");
    }
    const result = await reconcileCallHistory(fromDate, toDate);
    return res.status(200).json({ message: "OK", data: result });
  },

  async updateCallLogNote(req: Request, res: Response) {
    const { note } = req.body;
    if (typeof note !== "string") {
      throw new ArgumentInvalidException("note là bắt buộc");
    }
    await updateCallLogNote(req.permissionAbility!, req.params.id, note);
    return res.status(200).json({ message: "Cập nhật ghi chú thành công" });
  },

  async recordCallAttempt(req: Request, res: Response) {
    const data = await recordCallAttempt(req.permissionAbility!, req.params.id);
    return res.status(200).json({ message: "OK", data });
  }
};

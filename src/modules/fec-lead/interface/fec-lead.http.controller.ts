import { Request, Response } from "express";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { exportFecLeadsForViewer } from "../../../workflows/export-fec-leads.workflow";
import {
  getFecLeadHistoryForViewer,
  listFecLeadsForViewer
} from "../../../workflows/list-fec-leads.workflow";
import {
  UpsertFecLeadHistoryInput,
  UpsertFecLeadInput,
  upsertFecLead
} from "../application/upsert-fec-lead.service";

function parseInput(body: Record<string, any>): UpsertFecLeadInput {
  const customer = body?.customer ?? {};
  const lead = body?.lead ?? {};

  if (!customer.external_id) throw new ArgumentInvalidException("Thiếu customer.external_id");
  if (!lead.lead_gen_id) throw new ArgumentInvalidException("Thiếu lead.lead_gen_id");

  return {
    app_code: body.app_code,
    partner: body.partner,
    event_id: body.event_id,
    event_type: body.event_type,
    sent_at: body.sent_at,
    customer_external_id: customer.external_id,
    lead_gen_id: lead.lead_gen_id,
    trans_id: lead.trans_id,
    lead_status: lead.lead_status,
    created_at: lead.created_at,
    stage: lead.stage,
    current_status: lead.current_status,
    current_status_at: lead.current_status_at,
    last_step: lead.last_step,
    stop_reason: lead.stop_reason,
    dropped_off: lead.dropped_off,
    is_final: lead.is_final,
    app_id: lead.app_id,
    app_type: lead.app_type,
    offer_amt: lead.offer_amt,
    cash_amt: lead.cash_amt,
    insurance_amt: lead.insurance_amt,
    topup_amt: lead.topup_amt,
    fec_referral_code: lead.fec_referral_code,
    version: lead.version,
    last_event_at: lead.last_event_at,
    history: (lead.history ?? []) as UpsertFecLeadHistoryInput[]
  };
}

export const fecLeadHttpController = {
  async upsert(req: Request, res: Response) {
    const input = parseInput(req.body);
    const result = await upsertFecLead(input);
    return res.status(200).json({
      message: "Đã nhận",
      outcome: result.outcome,
      lead_gen_id: result.leadGenId
    });
  },

  // Danh sách khách FE Credit cho Sale/quản lý (theo phạm vi quyền customer.view)
  async list(req: Request, res: Response) {
    const { app_code, bucket, q, page, limit } = req.query;
    if ([app_code, bucket, q].some((v) => v !== undefined && typeof v !== "string")) {
      throw new ArgumentInvalidException("Tham số không hợp lệ");
    }
    const result = await listFecLeadsForViewer(req.permissionAbility!, {
      appCode: (app_code as string | undefined) || "vnfite",
      bucket: bucket as string | undefined,
      q: q as string | undefined,
      page,
      limit
    });
    return res.status(200).json({ message: "OK", ...result });
  },

  // Xuất Excel theo nhóm/từ khoá đang xem — cần quyền customer.export, có ghi nhật ký xuất dữ liệu
  async export(req: Request, res: Response) {
    const { app_code, bucket, q } = req.query;
    if ([app_code, bucket, q].some((v) => v !== undefined && typeof v !== "string")) {
      throw new ArgumentInvalidException("Tham số không hợp lệ");
    }
    const { buffer, filename } = await exportFecLeadsForViewer(req.permissionAbility!, {
      appCode: (app_code as string | undefined) || "vnfite",
      bucket: bucket as string | undefined,
      q: q as string | undefined,
      accountId: req.account!._id,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  },

  async history(req: Request, res: Response) {
    const result = await getFecLeadHistoryForViewer(req.permissionAbility!, req.params.leadGenId);
    return res.status(200).json({ message: "OK", data: result });
  }
};

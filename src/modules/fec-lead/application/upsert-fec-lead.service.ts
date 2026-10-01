import mongoose, { ClientSession } from "mongoose";
import AppModel from "../../../models/AppModel";
import CustomerModel from "../../../models/CustomerModel";
import FecLeadEventModel from "../../../models/FecLeadEventModel";
import FecLeadVersionModel from "../../../models/FecLeadVersionModel";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import { FecLeadEntity } from "../domain/fec-lead.entity";
import { FecLeadHistoryItem, FecLeadProps, FecLeadStage } from "../domain/types";
import { FecLeadRepository } from "../infrastructure/fec-lead.repository";
import "./fec-lead-commission.handler";

const fecLeadRepository = new FecLeadRepository();

export interface UpsertFecLeadHistoryInput {
  callback_id: string;
  status: string;
  remark?: string | null;
  request_time?: string | null;
  received_at: string;
  app_id?: string | null;
  app_type?: string | null;
  offer_amt?: number | null;
  cash_amt?: number | null;
  insurance_amt?: number | null;
  topup_amt?: number | null;
}

export interface UpsertFecLeadInput {
  app_code: string;
  partner: string;
  event_id: string;
  event_type: string;
  sent_at: string;
  customer_external_id: string;
  lead_gen_id: string;
  trans_id: string;
  lead_status: string;
  created_at: string;
  stage: FecLeadStage;
  current_status?: string | null;
  current_status_at?: string | null;
  last_step?: string | null;
  stop_reason?: string | null;
  dropped_off: boolean;
  is_final: boolean;
  app_id?: string | null;
  app_type?: string | null;
  offer_amt?: number | null;
  cash_amt?: number | null;
  insurance_amt?: number | null;
  topup_amt?: number | null;
  fec_referral_code?: string | null;
  version: number;
  last_event_at: string;
  history: UpsertFecLeadHistoryInput[];
}

export type UpsertFecLeadOutcome =
  | "created"
  | "updated"
  | "skipped_duplicate_event"
  | "skipped_stale_version";

export interface UpsertFecLeadResult {
  outcome: UpsertFecLeadOutcome;
  leadGenId: string;
}

function assertRequiredFields(input: UpsertFecLeadInput): void {
  if (!input.app_code) throw new ArgumentInvalidException("Thiếu app_code");
  if (!input.event_id) throw new ArgumentInvalidException("Thiếu event_id");
  if (!input.customer_external_id) throw new ArgumentInvalidException("Thiếu customer.external_id");
  if (!input.lead_gen_id) throw new ArgumentInvalidException("Thiếu lead.lead_gen_id");
  if (!input.stage) throw new ArgumentInvalidException("Thiếu lead.stage");
  if (!Number.isFinite(input.version)) throw new ArgumentInvalidException("Thiếu lead.version");
}

function toHistoryItem(input: UpsertFecLeadHistoryInput): FecLeadHistoryItem {
  return {
    callback_id: input.callback_id,
    status: input.status,
    remark: input.remark ?? null,
    request_time: input.request_time ?? null,
    received_at: new Date(input.received_at),
    app_id: input.app_id ?? null,
    app_type: input.app_type ?? null,
    offer_amt: input.offer_amt ?? null,
    cash_amt: input.cash_amt ?? null,
    insurance_amt: input.insurance_amt ?? null,
    topup_amt: input.topup_amt ?? null
  };
}

function buildProps(input: UpsertFecLeadInput, customerId: string): FecLeadProps {
  return {
    app_code: input.app_code,
    partner: input.partner,
    customer_id: customerId,
    customer_external_id: input.customer_external_id,
    lead_gen_id: input.lead_gen_id,
    trans_id: input.trans_id,
    lead_status: input.lead_status,
    lead_created_at: new Date(input.created_at),
    stage: input.stage,
    current_status: input.current_status ?? null,
    current_status_at: input.current_status_at ? new Date(input.current_status_at) : null,
    last_step: input.last_step ?? null,
    stop_reason: input.stop_reason ?? null,
    dropped_off: input.dropped_off,
    is_final: input.is_final,
    app_id: input.app_id ?? null,
    app_type: input.app_type ?? null,
    offer_amt: input.offer_amt ?? null,
    cash_amt: input.cash_amt ?? null,
    insurance_amt: input.insurance_amt ?? null,
    topup_amt: input.topup_amt ?? null,
    fec_referral_code: input.fec_referral_code ?? null,
    version: input.version,
    last_event_at: new Date(input.last_event_at),
    last_event_id: input.event_id,
    history: (input.history ?? []).map(toHistoryItem)
  };
}

function buildVersionSnapshot(props: FecLeadProps, eventId: string) {
  return {
    lead_gen_id: props.lead_gen_id,
    customer_id: props.customer_id,
    event_id: eventId,
    version: props.version,
    stage: props.stage,
    current_status: props.current_status,
    current_status_at: props.current_status_at,
    last_step: props.last_step,
    stop_reason: props.stop_reason,
    dropped_off: props.dropped_off,
    is_final: props.is_final,
    offer_amt: props.offer_amt,
    cash_amt: props.cash_amt,
    insurance_amt: props.insurance_amt,
    topup_amt: props.topup_amt,
    applied_at: new Date()
  };
}

async function findCustomerId(
  input: UpsertFecLeadInput,
  session: ClientSession
): Promise<string | null> {
  const app = await AppModel.findOne({ code: input.app_code, is_active: true }).session(session);
  if (!app) return null;

  const customer = await CustomerModel.findOne({
    app_id: app._id,
    external_id: input.customer_external_id,
    isDeleted: false
  })
    .select("_id")
    .session(session);

  return customer ? customer._id.toString() : null;
}

export async function upsertFecLead(input: UpsertFecLeadInput): Promise<UpsertFecLeadResult> {
  assertRequiredFields(input);

  const alreadyProcessed = await FecLeadEventModel.exists({ event_id: input.event_id });
  if (alreadyProcessed) {
    return { outcome: "skipped_duplicate_event", leadGenId: input.lead_gen_id };
  }

  const result = await runInTransaction(async (session) => {
    const customerId = await findCustomerId(input, session);
    if (!customerId) {
      throw new NotFoundException("Không tìm thấy khách hàng");
    }

    const newProps = buildProps(input, customerId);
    const existing = await fecLeadRepository.findByLeadGenId(input.lead_gen_id);

    let entity: FecLeadEntity;
    let outcome: UpsertFecLeadOutcome;

    if (!existing) {
      const id = new mongoose.Types.ObjectId().toString();
      entity = FecLeadEntity.create({ id, props: newProps });
      await fecLeadRepository.insert(entity);
      outcome = "created";
    } else {
      const { applied } = existing.applyUpdate(newProps);
      if (!applied) {
        await FecLeadEventModel.create(
          [{ event_id: input.event_id, lead_gen_id: input.lead_gen_id }],
          {
            session
          }
        );
        return { outcome: "skipped_stale_version" as const, entity: null };
      }
      await fecLeadRepository.updateById(existing.id, existing);
      entity = existing;
      outcome = "updated";
    }

    await FecLeadEventModel.create([{ event_id: input.event_id, lead_gen_id: input.lead_gen_id }], {
      session
    });
    await FecLeadVersionModel.create([buildVersionSnapshot(newProps, input.event_id)], { session });

    return { outcome, entity };
  });

  if (result.entity) {
    result.entity.publishEvents(eventBus).catch(() => {});
  }

  return { outcome: result.outcome, leadGenId: input.lead_gen_id };
}

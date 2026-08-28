import mongoose from "mongoose";
import CustomerModel from "../../../models/CustomerModel";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { CallLogRepository } from "../infrastructure/call-log.repository";
import { CustomerCallStatsRepository } from "../infrastructure/customer-call-stats.repository";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { CallLogEntity, CallLogPayload, CallLogDirection } from "../domain/call-log.entity";
import { CustomerCallStatsEntity } from "../domain/customer-call-stats.entity";
import { normalizePhoneNumber } from "../domain/normalize-phone-number";

const callLogRepository = new CallLogRepository();
const customerCallStatsRepository = new CustomerCallStatsRepository();
const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export interface OmicallWebhookPayload {
  transaction_id: string;
  call_uuid: string;
  direction: CallLogDirection;
  phone_number: string;
  hotline?: string;
  from_number?: string;
  to_number?: string;
  sip_user?: string;
  answer_sec?: number;
  bill_sec?: number;
  duration?: number;
  call_out_price?: number;
  time_start_call: number;
  time_ringing_start?: number | null;
  time_answer_start?: number | null;
  time_end_call?: number | null;
  hangup_cause?: string;
  recording_file_url?: string;
  record_seconds?: number;
  note?: string;
  tag?: string[];
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  if (unixSeconds === null || unixSeconds === undefined || unixSeconds === 0) return null;
  return new Date(unixSeconds * 1000);
}

export async function handleOmicallWebhook(payload: OmicallWebhookPayload): Promise<void> {
  const normalizedPhoneNumber = normalizePhoneNumber(payload.phone_number);

  const [saleProfile, customer] = await Promise.all([
    payload.sip_user
      ? saleOmicallProfileRepository.findByExtension(payload.sip_user)
      : Promise.resolve(null),
    CustomerModel.findOne({ phone_number: normalizedPhoneNumber, isDeleted: false }).lean()
  ]);

  const callLogPayload: CallLogPayload = {
    transactionId: payload.transaction_id,
    callUuid: payload.call_uuid,
    direction: payload.direction,
    phoneNumber: payload.phone_number,
    hotline: payload.hotline ?? "",
    fromNumber: payload.from_number ?? "",
    toNumber: payload.to_number ?? "",
    sipUser: payload.sip_user ?? "",
    saleId: saleProfile?.saleId ?? null,
    customerId: customer ? String((customer as { _id: unknown })._id) : null,
    answerSec: payload.answer_sec ?? 0,
    billSec: payload.bill_sec ?? 0,
    duration: payload.duration ?? 0,
    callOutPrice: payload.call_out_price ?? 0,
    timeStartCall: new Date(payload.time_start_call * 1000),
    timeRingingStart: toDate(payload.time_ringing_start),
    timeAnswerStart: toDate(payload.time_answer_start),
    timeEndCall: toDate(payload.time_end_call),
    hangupCause: payload.hangup_cause ?? "",
    recordingFileUrl: payload.recording_file_url ?? "",
    recordSeconds: payload.record_seconds ?? 0,
    note: payload.note ?? "",
    tag: payload.tag ?? [],
    rawPayload: payload
  };

  await runInTransaction(async () => {
    const existing = await callLogRepository.findByTransactionId(payload.transaction_id);

    if (existing) {
      existing.applyWebhookPayload(callLogPayload);
      await callLogRepository.updateById(existing.id, existing);
      return;
    }

    const callLogId = new mongoose.Types.ObjectId().toString();
    const callLog = CallLogEntity.create({ id: callLogId, ...callLogPayload });
    await callLogRepository.insert(callLog);

    if (!callLogPayload.customerId) return;

    const stats = await customerCallStatsRepository.findByCustomerId(callLogPayload.customerId);
    if (stats) {
      stats.recordCallAttempt(callLogPayload.timeStartCall);
      await customerCallStatsRepository.updateById(stats.id, stats);
      return;
    }

    const statsId = new mongoose.Types.ObjectId().toString();
    const newStats = CustomerCallStatsEntity.create({
      id: statsId,
      customerId: callLogPayload.customerId
    });
    newStats.recordCallAttempt(callLogPayload.timeStartCall);
    await customerCallStatsRepository.insert(newStats);
  });
}

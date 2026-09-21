import mongoose from "mongoose";
import { CallLogRepository } from "../infrastructure/call-log.repository";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { CallLogEntity, CallLogPayload, CallLogDirection } from "../domain/call-log.entity";
import { normalizePhoneNumber } from "../domain/normalize-phone-number";
import { resolveCustomerForCall } from "./resolve-customer-for-call";
import { getIO } from "../../../sockets/ioRegistry";

const callLogRepository = new CallLogRepository();
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

  const saleProfile = payload.sip_user
    ? await saleOmicallProfileRepository.findByExtension(payload.sip_user)
    : null;
  const customer = await resolveCustomerForCall(
    normalizedPhoneNumber,
    payload.hotline,
    saleProfile?.saleId ?? null
  );

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
    customerId: customer ? String(customer._id) : null,
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

  const existing = await callLogRepository.findByTransactionId(payload.transaction_id);

  let callLogId: string;
  if (existing) {
    existing.applyWebhookPayload(callLogPayload);
    await callLogRepository.updateById(existing.id, existing);
    callLogId = existing.id;
  } else {
    callLogId = new mongoose.Types.ObjectId().toString();
    const callLog = CallLogEntity.create({ id: callLogId, ...callLogPayload });
    await callLogRepository.insert(callLog);
  }

  if (callLogPayload.timeEndCall && callLogPayload.saleId) {
    const io = getIO();
    io?.to(`user:${callLogPayload.saleId}`).emit("customer_call:rate", {
      callLogId,
      phoneNumber: callLogPayload.phoneNumber,
      direction: callLogPayload.direction,
      duration: callLogPayload.duration
    });
  }
}

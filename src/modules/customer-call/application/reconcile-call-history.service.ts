import mongoose from "mongoose";
import CustomerModel from "../../../models/CustomerModel";
import CallLogModel from "../../../models/CallLogModel";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { OmicallClient, CallTransactionDetail } from "../../../utils/omicallClient";
import { CallLogRepository } from "../infrastructure/call-log.repository";
import { CustomerCallStatsRepository } from "../infrastructure/customer-call-stats.repository";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { CallLogEntity, CallLogPayload } from "../domain/call-log.entity";
import { CustomerCallStatsEntity } from "../domain/customer-call-stats.entity";
import { normalizePhoneNumber } from "../domain/normalize-phone-number";

const omicallClient = new OmicallClient();
const callLogRepository = new CallLogRepository();
const customerCallStatsRepository = new CustomerCallStatsRepository();
const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

const PAGE_SIZE = 50;

export interface ReconcileCallHistoryResult {
  scanned: number;
  backfilled: number;
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  if (unixSeconds === null || unixSeconds === undefined) return null;
  return new Date(unixSeconds * 1000);
}

async function fetchAllTransactionIds(fromDate: Date, toDate2: Date): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const result = await omicallClient.searchCallTransactions({
      page,
      size: PAGE_SIZE,
      filter: { fromDate: fromDate.getTime(), toDate: toDate2.getTime() }
    });

    result.items.forEach((item) => ids.push(item.transaction_id));

    if (!result.has_next || result.items.length < PAGE_SIZE) break;
    page += 1;
  }

  return ids;
}

async function buildPayloadFromDetail(detail: CallTransactionDetail): Promise<CallLogPayload> {
  const [saleProfile, customer] = await Promise.all([
    detail.sip_user
      ? saleOmicallProfileRepository.findByExtension(detail.sip_user)
      : Promise.resolve(null),
    detail.phone_number
      ? CustomerModel.findOne({
          phone_number: normalizePhoneNumber(detail.phone_number),
          isDeleted: false
        }).lean()
      : Promise.resolve(null)
  ]);

  return {
    transactionId: detail.transaction_id,
    callUuid: detail.transaction_id,
    direction: detail.direction as CallLogPayload["direction"],
    phoneNumber: detail.phone_number ?? "",
    hotline: detail.sip_number ?? "",
    fromNumber: detail.source_number ?? "",
    toNumber: detail.destination_number ?? "",
    sipUser: detail.sip_user ?? "",
    saleId: saleProfile?.saleId ?? null,
    customerId: customer ? String((customer as { _id: unknown })._id) : null,
    answerSec: detail.answer_sec ?? 0,
    billSec: detail.bill_sec ?? 0,
    duration: detail.duration ?? 0,
    callOutPrice: detail.call_out_price ?? 0,
    timeStartCall: toDate(detail.time_start_call) ?? new Date(0),
    timeRingingStart: toDate(detail.time_ringing_start),
    timeAnswerStart: toDate(detail.time_answer_start),
    timeEndCall: toDate(detail.time_end_call),
    hangupCause: detail.hangup_cause ?? "",
    recordingFileUrl: detail.recording_file_url ?? "",
    recordSeconds: detail.record_seconds ?? 0,
    note: detail.note ?? "",
    tag: detail.tag ?? [],
    rawPayload: detail
  };
}

async function backfillTransaction(transactionId: string): Promise<void> {
  const detail = await omicallClient.getCallTransactionById(transactionId);
  if (!detail) return;

  const payload = await buildPayloadFromDetail(detail);

  await runInTransaction(async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const callLog = CallLogEntity.create({ id, ...payload });
    await callLogRepository.insert(callLog);

    if (!payload.customerId) return;

    const stats = await customerCallStatsRepository.findByCustomerId(payload.customerId);
    if (stats) {
      stats.recordCallAttempt(payload.timeStartCall);
      await customerCallStatsRepository.updateById(stats.id, stats);
      return;
    }

    const statsId = new mongoose.Types.ObjectId().toString();
    const newStats = CustomerCallStatsEntity.create({
      id: statsId,
      customerId: payload.customerId
    });
    newStats.recordCallAttempt(payload.timeStartCall);
    await customerCallStatsRepository.insert(newStats);
  });
}

export async function reconcileCallHistory(
  fromDate: Date,
  toDate2: Date
): Promise<ReconcileCallHistoryResult> {
  const remoteIds = await fetchAllTransactionIds(fromDate, toDate2);
  if (!remoteIds.length) {
    return { scanned: 0, backfilled: 0 };
  }

  const existing = await CallLogModel.find({
    transaction_id: { $in: remoteIds },
    isDeleted: false
  })
    .select("transaction_id")
    .lean();
  const existingIds = new Set(existing.map((doc) => doc.transaction_id));
  const missingIds = remoteIds.filter((id) => !existingIds.has(id));

  for (const transactionId of missingIds) {
    // eslint-disable-next-line no-await-in-loop
    await backfillTransaction(transactionId);
  }

  return { scanned: remoteIds.length, backfilled: missingIds.length };
}

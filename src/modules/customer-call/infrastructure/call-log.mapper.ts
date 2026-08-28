import { CallLogEntity, CallLogPayload } from "../domain/call-log.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const callLogMapper: Mapper<CallLogEntity, any> = {
  toDomain(record) {
    return new CallLogEntity(
      {
        id: String(record._id),
        props: {
          transactionId: record.transaction_id,
          callUuid: record.call_uuid,
          direction: record.direction,
          phoneNumber: record.phone_number,
          hotline: record.hotline,
          fromNumber: record.from_number,
          toNumber: record.to_number,
          sipUser: record.sip_user,
          saleId: record.sale_id ? String(record.sale_id) : null,
          customerId: record.customer_id ? String(record.customer_id) : null,
          answerSec: record.answer_sec,
          billSec: record.bill_sec,
          duration: record.duration,
          callOutPrice: record.call_out_price,
          timeStartCall: record.time_start_call,
          timeRingingStart: record.time_ringing_start ?? null,
          timeAnswerStart: record.time_answer_start ?? null,
          timeEndCall: record.time_end_call ?? null,
          hangupCause: record.hangup_cause,
          recordingFileUrl: record.recording_file_url,
          recordSeconds: record.record_seconds,
          note: record.note,
          tag: record.tag ?? [],
          rawPayload: record.raw_payload ?? null
        } as CallLogPayload,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const props = entity.getProps();
    return {
      _id: props.id,
      transaction_id: props.transactionId,
      call_uuid: props.callUuid,
      direction: props.direction,
      phone_number: props.phoneNumber,
      hotline: props.hotline,
      from_number: props.fromNumber,
      to_number: props.toNumber,
      sip_user: props.sipUser,
      sale_id: props.saleId,
      customer_id: props.customerId,
      answer_sec: props.answerSec,
      bill_sec: props.billSec,
      duration: props.duration,
      call_out_price: props.callOutPrice,
      time_start_call: props.timeStartCall,
      time_ringing_start: props.timeRingingStart,
      time_answer_start: props.timeAnswerStart,
      time_end_call: props.timeEndCall,
      hangup_cause: props.hangupCause,
      recording_file_url: props.recordingFileUrl,
      record_seconds: props.recordSeconds,
      note: props.note,
      tag: props.tag,
      raw_payload: props.rawPayload
    };
  }
};

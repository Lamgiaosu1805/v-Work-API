import { Mapper } from "../../../core/db/mongoose-repository.base";
import { FecLeadDoc } from "../../../models/FecLeadModel";
import { FecLeadEntity } from "../domain/fec-lead.entity";
import { FecLeadProps } from "../domain/types";

export const fecLeadMapper: Mapper<FecLeadEntity, FecLeadDoc> = {
  toDomain(record) {
    return new FecLeadEntity(
      {
        id: String(record._id),
        props: {
          app_code: record.app_code,
          partner: record.partner,
          customer_id: String(record.customer_id),
          customer_external_id: record.customer_external_id,
          lead_gen_id: record.lead_gen_id,
          trans_id: record.trans_id,
          lead_status: record.lead_status,
          lead_created_at: record.lead_created_at,
          stage: record.stage,
          current_status: record.current_status,
          current_status_at: record.current_status_at,
          last_step: record.last_step,
          stop_reason: record.stop_reason,
          dropped_off: record.dropped_off,
          is_final: record.is_final,
          app_id: record.app_id,
          app_type: record.app_type,
          offer_amt: record.offer_amt,
          cash_amt: record.cash_amt,
          insurance_amt: record.insurance_amt,
          topup_amt: record.topup_amt,
          fec_referral_code: record.fec_referral_code,
          version: record.version,
          last_event_at: record.last_event_at,
          last_event_id: record.last_event_id,
          history: record.history ?? []
        } as FecLeadProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const { id, createdAt, updatedAt, ...rest } = entity.getProps();
    return { _id: id, ...rest };
  }
};

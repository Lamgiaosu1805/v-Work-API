import { FecLeadStage } from "../../../models/FecLeadModel";

export type { FecLeadStage };

export interface FecLeadHistoryItem {
  callback_id: string;
  status: string;
  remark: string | null;
  request_time: string | null;
  received_at: Date;
  app_id: string | null;
  app_type: string | null;
  offer_amt: number | null;
  cash_amt: number | null;
  insurance_amt: number | null;
  topup_amt: number | null;
}

export interface FecLeadProps {
  app_code: string;
  partner: string;
  customer_id: string;
  customer_external_id: string;
  lead_gen_id: string;
  trans_id: string;
  lead_status: string;
  lead_created_at: Date;
  stage: FecLeadStage;
  current_status: string | null;
  current_status_at: Date | null;
  last_step: string | null;
  stop_reason: string | null;
  dropped_off: boolean;
  is_final: boolean;
  app_id: string | null;
  app_type: string | null;
  offer_amt: number | null;
  cash_amt: number | null;
  insurance_amt: number | null;
  topup_amt: number | null;
  fec_referral_code: string | null;
  version: number;
  last_event_at: Date;
  last_event_id: string;
  history: FecLeadHistoryItem[];
}

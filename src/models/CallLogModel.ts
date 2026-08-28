import mongoose, { Schema, Document, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export type CallLogDirection = "outbound" | "inbound" | "local";

export interface CallLogDoc extends Document {
  transaction_id: string;
  call_uuid: string;
  direction: CallLogDirection;
  phone_number: string;
  hotline: string;
  from_number: string;
  to_number: string;
  sip_user: string;
  sale_id: mongoose.Types.ObjectId | null;
  customer_id: mongoose.Types.ObjectId | null;
  answer_sec: number;
  bill_sec: number;
  duration: number;
  call_out_price: number;
  time_start_call: Date;
  time_ringing_start: Date | null;
  time_answer_start: Date | null;
  time_end_call: Date | null;
  hangup_cause: string;
  recording_file_url: string;
  record_seconds: number;
  note: string;
  tag: string[];
  raw_payload: unknown;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CallLogSchema = new Schema<CallLogDoc>(
  {
    transaction_id: { type: String, required: true },
    call_uuid: { type: String, required: true },
    direction: { type: String, enum: ["outbound", "inbound", "local"], required: true },
    phone_number: { type: String, required: true },
    hotline: { type: String, default: "" },
    from_number: { type: String, default: "" },
    to_number: { type: String, default: "" },
    sip_user: { type: String, default: "" },
    sale_id: { type: Schema.Types.ObjectId, ref: "user_info", default: null },
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", default: null },
    answer_sec: { type: Number, default: 0 },
    bill_sec: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    call_out_price: { type: Number, default: 0 },
    time_start_call: { type: Date, required: true },
    time_ringing_start: { type: Date, default: null },
    time_answer_start: { type: Date, default: null },
    time_end_call: { type: Date, default: null },
    hangup_cause: { type: String, default: "" },
    recording_file_url: { type: String, default: "" },
    record_seconds: { type: Number, default: 0 },
    note: { type: String, default: "" },
    tag: { type: [String], default: [] },
    raw_payload: { type: Schema.Types.Mixed, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions<CallLogDoc>["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions<CallLogDoc>["toObject"]
  }
);

CallLogSchema.index(
  { transaction_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
CallLogSchema.index({ sale_id: 1, time_start_call: -1 });
CallLogSchema.index({ customer_id: 1, time_start_call: -1 });

export default mongoose.model<CallLogDoc>("call_log", CallLogSchema);

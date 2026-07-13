const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const ObjId = mongoose.Schema.Types.ObjectId;

const RequestSchema = new mongoose.Schema(
  {
    user_id: { type: ObjId, ref: "user_info", required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    reason: { type: String, default: "" },
    assigned_reviewer: { type: ObjId, ref: "user_info", required: true },
    reviewed_by: { type: ObjId, ref: "user_info", default: null },
    reviewed_at: { type: Date, default: null },
    reviewer_note: { type: String, default: "" },
    ...BaseSchema.obj,
  },
  {
    discriminatorKey: "request_type",
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  },
);

RequestSchema.index({ user_id: 1, status: 1 });
RequestSchema.index({ assigned_reviewer: 1, status: 1 });
RequestSchema.index({ user_id: 1, request_type: 1, status: 1 });

const RequestModel = mongoose.model("request", RequestSchema);

const LeaveRequest = RequestModel.discriminator(
  "leave",
  new mongoose.Schema({
    from_date: { type: Date, required: true },
    from_period: {
      type: String,
      enum: ["morning", "afternoon"],
      required: true, 
    },
    to_date: { type: Date, required: true },
    to_period: { type: String, enum: ["morning", "afternoon"], required: true },
    total_days: { type: Number, required: true },
    leave_type: { type: String, enum: ["paid", "unpaid"], required: true },
    paid_days: { type: Number, default: 0 },
    unpaid_days: { type: Number, default: 0 },
  }),
);

const LateEarlyRequest = RequestModel.discriminator(
  "late_early",
  new mongoose.Schema({
    date: { type: Date, required: true },
    shift_id: { type: ObjId, ref: "shift", required: true },
    type: { type: String, enum: ["late", "early_out"], required: true },
    minutes: { type: Number, required: true },
  }),
);

const RemoteRequest = RequestModel.discriminator(
  "remote",
  new mongoose.Schema({
    from_date: { type: Date, required: true },
    to_date: { type: Date, required: true },
    total_days: { type: Number, required: true },
  }),
);

const ExplanationRequest = RequestModel.discriminator(
  "explanation",
  new mongoose.Schema({
    date: { type: Date, required: true },
    shift_id: { type: ObjId, ref: "shift", default: null },
    content: { type: String, required: true },
  }),
);

const ForgotCheckinRequest = RequestModel.discriminator(
  "forgot_checkin",
  new mongoose.Schema({
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: ["check_in", "check_out", "both"],
      required: true,
    },
    expected_check_in: { type: Date, default: null },
    expected_check_out: { type: Date, default: null },
  }),
);

module.exports = {
  RequestModel,
  LeaveRequest,
  LateEarlyRequest,
  RemoteRequest,
  ExplanationRequest,
  ForgotCheckinRequest,
};

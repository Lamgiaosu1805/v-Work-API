import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Trạng thái nhận khách của Sale (mở / tạm dừng / khoá) + hạng + hạn mức riêng.
// Owner: module customer-care.

const SaleAllocationProfileSchema = new Schema(
  {
    sale_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    status: { type: String, enum: ["open", "paused", "locked"], default: "open" },
    reason: { type: String, default: null },
    until: { type: Date, default: null },
    set_by: { type: Schema.Types.ObjectId, ref: "account", default: null },
    set_at: { type: Date, default: null },
    rank: { type: String, enum: ["A", "B", "C", "D"], default: "C" },
    cap_new_per_day: { type: Number, default: null },
    cap_total: { type: Number, default: null },
    last_assigned_at: { type: Date, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "sale_allocation_profile"
  }
);

SaleAllocationProfileSchema.index(
  { sale_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model("sale_allocation_profile", SaleAllocationProfileSchema);

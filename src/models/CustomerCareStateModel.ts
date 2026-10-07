import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Trạng thái chăm sóc / Pool của từng khách (Quy định 183A). Owner: module customer-care.

const CustomerCareStateSchema = new Schema(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", required: true },
    app_id: { type: Schema.Types.ObjectId, ref: "app", required: true },
    pool_status: {
      type: String,
      enum: ["in_pool", "assigned", "nurturing", "converted", "excluded"],
      required: true
    },
    priority_class: { type: String, enum: ["A", "B", "C"], required: true },
    round_count: { type: Number, default: 0 },
    current_assignment_id: {
      type: Schema.Types.ObjectId,
      ref: "customer_assignment",
      default: null
    },
    current_sale_id: { type: Schema.Types.ObjectId, ref: "user_info", default: null },
    previous_sale_ids: [{ type: Schema.Types.ObjectId, ref: "user_info" }],
    entered_pool_at: { type: Date, default: null },
    converted_at: { type: Date, default: null },
    status_reason: { type: String, default: null },
    // Ưu tiên thấp (khách dưới 18 tuổi — chốt 07/10/2026): vẫn vào kho, phân sau mọi khách khác
    low_priority: { type: Boolean, default: false },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "customer_care_state"
  }
);

CustomerCareStateSchema.index(
  { customer_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
CustomerCareStateSchema.index({
  app_id: 1,
  pool_status: 1,
  low_priority: 1,
  priority_class: 1,
  entered_pool_at: 1
});

export default mongoose.model("customer_care_state", CustomerCareStateSchema);

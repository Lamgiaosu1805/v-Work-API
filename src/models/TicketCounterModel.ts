import mongoose, { Schema } from "mongoose";

// Bộ đếm sinh mã ticket TK-YYMM-NNNN theo tháng (findOneAndUpdate $inc — nguyên tử). Owner: module ticket.

const TicketCounterSchema = new Schema(
  {
    // "2610" = tháng 10/2026
    period: { type: String, required: true },
    seq: { type: Number, default: 0 }
  },
  { collection: "ticket_counter" }
);

TicketCounterSchema.index({ period: 1 }, { unique: true });

export default mongoose.model("ticket_counter", TicketCounterSchema);

import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Phiên bản bộ văn bản nội quy cho Trợ lý Nội quy. Owner: module handbook-assistant.
// Chỉ có đúng 1 phiên bản `active` tại một thời điểm (partial unique index bên dưới).

export const HANDBOOK_VERSION_STATUSES = ["draft", "active", "archived"] as const;
export type HandbookVersionStatus = (typeof HANDBOOK_VERSION_STATUSES)[number];

const HandbookVersionSchema = new Schema(
  {
    versionNo: { type: Number, required: true, min: 1 },
    status: { type: String, enum: HANDBOOK_VERSION_STATUSES, default: "draft", required: true },
    documents: {
      type: [
        new Schema(
          {
            documentCode: { type: String, required: true },
            documentTitle: { type: String, required: true },
            shortName: { type: String, required: true },
            articleCount: { type: Number, required: true, min: 0 },
            sourceFileName: { type: String, default: null },
            sourceSha256: { type: String, default: null }
          },
          { _id: false }
        )
      ],
      default: []
    },
    suggestions: { type: [String], default: [] },
    // Số token của toàn bộ văn bản khi gửi cho Claude (đo bằng count_tokens); null = chưa đo.
    promptTokens: { type: Number, default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: "account", default: null },
    note: { type: String, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "handbook_version"
  }
);

HandbookVersionSchema.index({ versionNo: 1 }, { unique: true });
// Tối đa 1 phiên bản đang hiệu lực
HandbookVersionSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: "active", isDeleted: false } }
);

export default mongoose.model("handbook_version", HandbookVersionSchema);

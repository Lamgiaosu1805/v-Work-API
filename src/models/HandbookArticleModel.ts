import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Một Điều / mục của văn bản nội quy trong một phiên bản. Owner: module handbook-assistant.
// `blocks` là từng khoản/điểm (đơn vị trích dẫn nhỏ nhất); `content` = blocks nối bằng "\n".

const HandbookArticleSchema = new Schema(
  {
    version: { type: Schema.Types.ObjectId, ref: "handbook_version", required: true },
    documentCode: { type: String, required: true },
    documentTitle: { type: String, required: true },
    articleIdx: { type: Number, required: true, min: 0 },
    label: { type: String, required: true },
    title: { type: String, required: true },
    chapter: { type: String, default: "" },
    content: { type: String, required: true },
    blocks: { type: [String], default: [] },
    order: { type: Number, required: true, min: 0 },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "handbook_article"
  }
);

HandbookArticleSchema.index({ version: 1, documentCode: 1, articleIdx: 1 }, { unique: true });
HandbookArticleSchema.index({ version: 1, order: 1 });

export default mongoose.model("handbook_article", HandbookArticleSchema);

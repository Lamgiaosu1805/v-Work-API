import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Cấu hình phiên bản app mobile theo nền tảng (1 document / platform). Dưới min_version → app bị chặn,
// buộc cập nhật; dưới latest_version → chỉ gợi ý. Owner: module app-release.
const AppReleaseSchema = new Schema(
  {
    platform: { type: String, enum: ["ios", "android"], required: true },
    min_version: { type: String, default: null },
    latest_version: { type: String, default: null },
    store_url: { type: String, default: null },
    message: { type: String, default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: "account", default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "app_release"
  }
);

AppReleaseSchema.index({ platform: 1 }, { unique: true });

export default mongoose.model("app_release", AppReleaseSchema);

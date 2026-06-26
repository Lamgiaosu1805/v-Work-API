const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const NotificationSchema = new mongoose.Schema(
  {
    target: { type: String, enum: ["individual", "broadcast"], default: "individual" },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    type: { type: String, required: true },
    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    ref_type: { type: String, default: null },
    uri: { type: String, default: null },
    read_by: [{ type: mongoose.Schema.Types.ObjectId, ref: "account" }],
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

NotificationSchema.index({ account_id: 1, createdAt: -1 });
NotificationSchema.index({ target: 1, createdAt: -1 });
NotificationSchema.index({ read_by: 1 });
NotificationSchema.index(
  { account_id: 1, type: 1, ref_id: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false, type: "chat_message" },
    name: "chat_notification_unique"
  }
);

module.exports = mongoose.model("notification", NotificationSchema);

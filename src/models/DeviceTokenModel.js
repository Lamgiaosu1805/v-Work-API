const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const DeviceTokenSchema = new mongoose.Schema(
  {
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "account",
      required: true,
      index: true,
    },
    fcm_token: {
      type: String,
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web"],
      default: "android",
    },
    device_id: {
      type: String,
      required: true,
      index: true,
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
    last_used_at: {
      type: Date,
      default: Date.now,
    },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

DeviceTokenSchema.index({ account_id: 1, is_active: 1 });
DeviceTokenSchema.index({ account_id: 1, device_id: 1 });
DeviceTokenSchema.index({ device_id: 1, is_active: 1 });

module.exports = mongoose.model("device_token", DeviceTokenSchema);

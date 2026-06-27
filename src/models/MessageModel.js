const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const MessageModel = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "conversation",
      required: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_info",
      required: true
    },
    type: {
      type: String,
      enum: ["text", "image", "audio", "system"],
      default: "text"
    },
    content: {
      type: String,
      default: ""
    },
    attachment: {
      url: { type: String, default: null },
      thumbnailUrl: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      originalName: { type: String, default: null }
    },
    seenBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user_info"
      }
    ],
    recalled: {
      at: { type: Date, default: null },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null }
    },
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user_info"
      }
    ],
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

MessageModel.index({ conversationId: 1, createdAt: -1 });
MessageModel.index({ conversationId: 1, deletedFor: 1 });

module.exports = mongoose.model("message", MessageModel);

const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const MessageModel = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "conversation",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_info",
      required: true,
    },
    type: {
      type: String,
      enum: ["text", "image", "audio", "system"],
      default: "text",
    },
    content: {
      type: String,
      default: "",
    },
    seenBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user_info",
      },
    ],
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  },
);

module.exports = mongoose.model("message", MessageModel);

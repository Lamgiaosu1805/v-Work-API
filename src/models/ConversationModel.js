const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const ConversationModel = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["private", "group"],
      default: "private",
    },
    name: {
      type: String,
      default: "",
    },
    pairKey: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: "",
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user_info",
      },
    ],
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user_info",
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "message",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_info",
    },
    deletedFor: [
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

ConversationModel.index({ members: 1, updatedAt: -1 });
ConversationModel.index(
  { pairKey: 1 },
  { unique: true, partialFilterExpression: { pairKey: { $type: "string" } } }
);

module.exports = mongoose.model("conversation", ConversationModel);

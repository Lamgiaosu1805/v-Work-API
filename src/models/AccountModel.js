const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AccountModel = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isFirstLogin: { type: Boolean, default: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    refreshTokens: [
      {
        token: String,
        createdAt: Date,
        expiresAt: Date,
        revoked: { type: Boolean, default: false }
      }
    ],
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("account", AccountModel);
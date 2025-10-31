const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

// Kế thừa từ BaseSchema (bao gồm isDeleted + timestamps)
const AccountModel = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    ...BaseSchema.obj, // kế thừa các field trong BaseSchema
  },
  {
    timestamps: BaseSchema.options.timestamps, // kế thừa timestamps
    toJSON: BaseSchema.options.toJSON, // kế thừa format giờ Việt Nam
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("account", AccountModel);
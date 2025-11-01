const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const DocumentTypeModel = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    required: { type: Boolean, default: false },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("document_type", DocumentTypeModel);

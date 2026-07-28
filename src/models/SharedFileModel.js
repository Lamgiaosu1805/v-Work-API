const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const SharedFileSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    folder_id: { type: mongoose.Schema.Types.ObjectId, ref: "shared_folder", default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
    deletedAt: { type: Date, default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

SharedFileSchema.index({ folder_id: 1 });
SharedFileSchema.index({ folder_id: 1, isDeleted: 1 });

module.exports = mongoose.model("shared_file", SharedFileSchema);

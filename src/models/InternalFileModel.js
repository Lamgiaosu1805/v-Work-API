const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const InternalFileSchema = new mongoose.Schema(
    {
        originalName: { type: String, required: true },
        filename: { type: String, required: true },
        departmentCode: { type: String, required: true },
        subfolder: { type: String, default: "" },
        category: { type: String, enum: ["general", "weekly_report"], default: "general" },
        mimeType: { type: String, default: "application/octet-stream" },
        size: { type: Number, default: 0 },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
        department: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
        folder_id: { type: mongoose.Schema.Types.ObjectId, ref: "internal_folder", default: null },
        deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
        deletedAt: { type: Date, default: null },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("internal_file", InternalFileSchema);

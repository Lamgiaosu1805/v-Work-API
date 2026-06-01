const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const InternalFolderSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        department: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
        departmentCode: { type: String, required: true },
        parent_id: { type: mongoose.Schema.Types.ObjectId, ref: "internal_folder", default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
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

module.exports = mongoose.model("internal_folder", InternalFolderSchema);

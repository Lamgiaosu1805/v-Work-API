const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const PrintJobModel = new mongoose.Schema(
    {
        account:     { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
        username:    { type: String, required: true },
        filename:    { type: String, required: true },
        pages:       { type: Number, default: 0 },
        copies:      { type: Number, default: 1 },
        duplex:      { type: Boolean, default: false },
        totalSheets: { type: Number, default: 0 },
        paperSize:   { type: String, default: "A4" },
        orientation: { type: String, default: "portrait" },
        pageRange:   { type: String, default: "all" },

        ...BaseSchema.obj,
    },
    {
        timestamps:  BaseSchema.options.timestamps,
        toJSON:      BaseSchema.options.toJSON,
        toObject:    BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("print_job", PrintJobModel);

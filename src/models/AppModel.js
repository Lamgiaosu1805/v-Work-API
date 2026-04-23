const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AppModel = new mongoose.Schema(
    {
        name: { type: String, required: true },        // "TikLuy", "App B"
        code: { type: String, required: true, unique: true }, // "tikluy", "appb" — dùng để gọi API
        description: { type: String, default: null },
        logo_url: { type: String, default: null },
        is_active: { type: Boolean, default: true },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("app", AppModel);
//Vị trí - Chức vụ
const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const PositionModel = new mongoose.Schema(
    {
        position_name: { type: String, required: true },
        description: { type: String },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("position", PositionModel);

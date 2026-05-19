const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AllowedWiFiLocationModel = new mongoose.Schema(
    {
        name: { type: String, default: "" },
        ssid: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        radius: { type: Number, default: 100 }, // bán kính hợp lệ (m)
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("allowed_wifi_location", AllowedWiFiLocationModel);
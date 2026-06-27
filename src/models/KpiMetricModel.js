const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_GROUP_VALUES, KPI_SOURCE_VALUES, KPI_AUTO_SOURCE_VALUES } = require("../constants");

const KpiMetricModel = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    group: { type: String, enum: KPI_GROUP_VALUES, required: true },
    unit: { type: String, default: "" },
    source: { type: String, enum: KPI_SOURCE_VALUES, required: true },
    auto_source: { type: String, enum: [...KPI_AUTO_SOURCE_VALUES, null], default: null },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

module.exports = mongoose.model("kpi_metric", KpiMetricModel);

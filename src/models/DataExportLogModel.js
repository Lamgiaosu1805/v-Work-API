const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

// Nhật ký xuất dữ liệu (Quy định 183A, Điều 11: tự ý xuất dữ liệu khách là hành vi gian lận) —
// ai xuất, lúc nào, bộ lọc gì, bao nhiêu dòng. Chỉ ghi thêm, không sửa/xoá.
const DataExportLogSchema = new mongoose.Schema(
  {
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    resource: { type: String, required: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    row_count: { type: Number, required: true },
    ip: { type: String, default: null },
    user_agent: { type: String, default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "data_export_log"
  }
);

DataExportLogSchema.index({ account_id: 1, createdAt: -1 });
DataExportLogSchema.index({ resource: 1, createdAt: -1 });

module.exports = mongoose.model("data_export_log", DataExportLogSchema);

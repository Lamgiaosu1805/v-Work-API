const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const WeeklyReportSchema = new mongoose.Schema(
    {
        department: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
        // Thứ 2 đầu tuần 00:00 Asia/Ho_Chi_Minh — dùng làm khóa nhận dạng tuần
        weekStart: { type: Date, required: true },
        // Thứ 6 18:00 Asia/Ho_Chi_Minh
        deadline: { type: Date, required: true },
        status: {
            type: String,
            enum: ["pending", "submitted", "late", "missing"],
            default: "pending",
        },
        // Trỏ vào InternalFile — null nếu chưa nộp
        file: { type: mongoose.Schema.Types.ObjectId, ref: "internal_file", default: null },
        submittedAt: { type: Date, default: null },
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
        note: { type: String, default: "" },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

// Mỗi phòng ban chỉ có 1 record / tuần
WeeklyReportSchema.index({ department: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model("weekly_report", WeeklyReportSchema);

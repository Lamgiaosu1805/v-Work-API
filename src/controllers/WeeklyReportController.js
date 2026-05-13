const fs = require("fs");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const WeeklyReportModel = require("../models/WeeklyReportModel");
const InternalFileModel = require("../models/InternalFileModel");
const AccountModel = require("../models/AccountModel");
const { getUserDeptIds, canViewDept } = require("./InternalFileController");
const { getInternalFilePath } = require("../middlewares/uploadInternal");
const { WEEKLY_REPORT_SUBFOLDER } = require("../middlewares/uploadWeeklyReport");

const TZ = "Asia/Ho_Chi_Minh";

function getWeekStart(date) {
    return moment(date).tz(TZ).startOf("isoWeek").toDate();
}

function getDeadlineOfWeek(weekStartDate) {
    return moment(weekStartDate).tz(TZ).add(4, "days").set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toDate();
}

// Xác định status khi nộp/nộp lại
function resolveStatus(existingStatus, deadline) {
    const isLate = moment().tz(TZ).isAfter(moment(deadline).tz(TZ));

    if (existingStatus === "submitted") return "submitted"; // đã nộp đúng hạn, update không bị phạt
    if (existingStatus === "late") return "late";           // đã muộn, vẫn muộn
    // pending hoặc missing → xem có còn trong deadline không
    return isLate ? "late" : "submitted";
}

const WeeklyReportController = {
    // GET /weekly-reports/my-dept
    // Trạng thái báo cáo tuần hiện tại của phòng ban user (hoặc ?week=2025-05-12)
    getMyDeptStatus: async (req, res) => {
        try {
            const accountId = req.account._id;
            const weekDate = req.query.week ? new Date(req.query.week) : new Date();
            const weekStart = getWeekStart(weekDate);

            const userDeptIds = await getUserDeptIds(accountId);
            if (!userDeptIds.length) {
                return res.status(404).json({ message: "Bạn chưa thuộc phòng ban nào" });
            }

            const reports = await WeeklyReportModel.find({
                department: { $in: userDeptIds },
                weekStart,
            })
                .populate("department", "department_name department_code")
                .populate("file", "originalName mimeType size")
                .populate("submittedBy", "username");

            return res.status(200).json({ message: "Thành công", data: reports });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /weekly-reports/admin?week=2025-05-12
    // Admin xem trạng thái tất cả phòng ban trong tuần
    getAdminDashboard: async (req, res) => {
        try {
            const weekDate = req.query.week ? new Date(req.query.week) : new Date();
            const weekStart = getWeekStart(weekDate);
            const deadline = getDeadlineOfWeek(weekStart);

            const reports = await WeeklyReportModel.find({ weekStart })
                .populate("department", "department_name department_code")
                .populate("file", "originalName mimeType size")
                .populate("submittedBy", "username")
                .sort({ status: 1 });

            return res.status(200).json({
                message: "Thành công",
                week: {
                    weekStart: moment(weekStart).tz(TZ).format("DD/MM/YYYY"),
                    deadline: moment(deadline).tz(TZ).format("HH:mm DD/MM/YYYY"),
                },
                data: reports,
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /weekly-reports/:deptId/history?page=1&limit=10
    // Lịch sử nộp báo cáo của phòng ban
    getHistory: async (req, res) => {
        try {
            const { deptId } = req.params;
            const accountId = req.account._id;
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(50, parseInt(req.query.limit) || 10);

            if (!(await canViewDept(accountId, deptId))) {
                return res.status(403).json({ message: "Bạn không có quyền xem phòng ban này" });
            }

            const total = await WeeklyReportModel.countDocuments({ department: deptId, isDeleted: false });
            const reports = await WeeklyReportModel.find({ department: deptId, isDeleted: false })
                .populate("file", "originalName mimeType size")
                .populate("submittedBy", "username")
                .sort({ weekStart: -1 })
                .skip((page - 1) * limit)
                .limit(limit);

            return res.status(200).json({
                message: "Thành công",
                data: reports,
                pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /weekly-reports/:deptId/submit
    // Nộp hoặc nộp lại báo cáo tuần
    // multer (uploadWeeklyReport) đã chạy trước, file nằm trong req.file
    submitReport: async (req, res) => {
        const { deptId } = req.params;
        const accountId = req.account._id;
        const { note = "" } = req.body;

        // Kiểm tra quyền trước — không cần giữ transaction trong lúc auth check
        const account = await AccountModel.findById(accountId);
        const userDeptIds = await getUserDeptIds(accountId);
        const isAdmin = account?.role === "admin";
        const isMember = userDeptIds.includes(deptId.toString());

        if (!isAdmin && !isMember) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(403).json({ message: "Bạn không thuộc phòng ban này" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "Không có file được gửi lên" });
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        // Path file cũ — chỉ xóa vật lý SAU KHI transaction commit thành công
        let oldFilePath = null;

        try {
            const weekStart = getWeekStart(new Date());
            const deadline = getDeadlineOfWeek(weekStart);

            let report = await WeeklyReportModel.findOne({ department: deptId, weekStart }).session(session);
            if (!report) {
                report = new WeeklyReportModel({ department: deptId, weekStart, deadline, status: "pending" });
            }

            // Soft-delete InternalFile cũ trong transaction
            if (report.file) {
                const oldFile = await InternalFileModel.findById(report.file).session(session);
                if (oldFile) {
                    oldFile.isDeleted = true;
                    await oldFile.save({ session });
                    oldFilePath = getInternalFilePath(oldFile.departmentCode, oldFile.subfolder, oldFile.filename);
                }
            }

            // Tạo InternalFile mới trong transaction (dùng array syntax khi có session)
            const [newFile] = await InternalFileModel.create([{
                originalName: req.file.originalname,
                filename: req.file.filename,
                departmentCode: req._deptCode,
                subfolder: WEEKLY_REPORT_SUBFOLDER,
                category: "weekly_report",
                mimeType: req.file.mimetype,
                size: req.file.size,
                uploadedBy: accountId,
                department: deptId,
            }], { session });

            // Cập nhật WeeklyReport trong transaction
            report.file = newFile._id;
            report.submittedAt = new Date();
            report.submittedBy = accountId;
            report.note = note;
            report.status = resolveStatus(report.status, deadline);
            await report.save({ session });

            await session.commitTransaction();

            // Xóa file vật lý cũ chỉ sau khi DB đã commit thành công
            if (oldFilePath && fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);

            return res.status(200).json({
                message: report.status === "late" ? "Nộp báo cáo thành công (trễ hạn)" : "Nộp báo cáo thành công",
                data: await report.populate([
                    { path: "file", select: "originalName mimeType size" },
                    { path: "submittedBy", select: "username" },
                    { path: "department", select: "department_name department_code" },
                ]),
            });
        } catch (error) {
            await session.abortTransaction();
            // Xóa file mới vừa upload vì transaction thất bại
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        } finally {
            session.endSession();
        }
    },

    // GET /weekly-reports/file/:reportId/view
    // Xem file báo cáo (check quyền)
    viewReportFile: async (req, res) => {
        try {
            const { reportId } = req.params;
            const accountId = req.account._id;

            const report = await WeeklyReportModel.findOne({ _id: reportId, isDeleted: false }).populate("file");
            if (!report) return res.status(404).json({ message: "Không tìm thấy báo cáo" });
            if (!report.file) return res.status(404).json({ message: "Báo cáo này chưa có file" });

            if (!(await canViewDept(accountId, report.department))) {
                return res.status(403).json({ message: "Bạn không có quyền xem báo cáo này" });
            }

            const file = report.file;
            const filePath = getInternalFilePath(file.departmentCode, file.subfolder, file.filename);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: "File không tồn tại trên server" });
            }

            res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
            return res.sendFile(filePath);
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },
};

module.exports = WeeklyReportController;

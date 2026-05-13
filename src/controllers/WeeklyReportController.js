const fs = require("fs");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const WeeklyReportModel = require("../models/WeeklyReportModel");
const InternalFileModel = require("../models/InternalFileModel");
const AccountModel = require("../models/AccountModel");
const { getUserDeptIds, canViewDept, getFullNameMap } = require("./InternalFileController");
const { getInternalFilePath } = require("../middlewares/uploadInternal");
const { WEEKLY_REPORT_SUBFOLDER } = require("../middlewares/uploadWeeklyReport");

const TZ = "Asia/Ho_Chi_Minh";

function getWeekStart(date) {
    return moment(date).tz(TZ).startOf("isoWeek").toDate();
}

function getDeadlineOfWeek(weekStartDate) {
    return moment(weekStartDate).tz(TZ).add(4, "days").set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toDate();
}

function resolveStatus(existingStatus, deadline) {
    const isLate = moment().tz(TZ).isAfter(moment(deadline).tz(TZ));
    if (existingStatus === "submitted") return "submitted";
    if (existingStatus === "late") return "late";
    return isLate ? "late" : "submitted";
}

// Merge full_name vào field submittedBy của danh sách report
async function mergeFullNames(reports) {
    const accountIds = reports.map((r) => r.submittedBy?._id).filter(Boolean);
    const fullNameMap = await getFullNameMap(accountIds);
    return reports.map((r) => {
        const obj = r.toJSON ? r.toJSON() : r;
        if (obj.submittedBy) obj.submittedBy.full_name = fullNameMap[obj.submittedBy._id?.toString()] || null;
        return obj;
    });
}

const WeeklyReportController = {
    // GET /weekly-reports/my-dept
    getMyDeptStatus: async (req, res) => {
        try {
            const accountId = req.account._id;
            const weekDate = req.query.week ? new Date(req.query.week) : new Date();
            const weekStart = getWeekStart(weekDate);

            const userDeptIds = await getUserDeptIds(accountId);
            if (!userDeptIds.length) {
                return res.status(404).json({ message: "Bạn chưa thuộc phòng ban nào" });
            }

            const reports = await WeeklyReportModel.find({ department: { $in: userDeptIds }, weekStart })
                .populate("department", "department_name department_code")
                .populate("file", "originalName mimeType size")
                .populate("submittedBy", "username");

            return res.status(200).json({ message: "Thành công", data: await mergeFullNames(reports) });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /weekly-reports/admin?week=2025-05-12
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
                data: await mergeFullNames(reports),
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // GET /weekly-reports/:deptId/history?page=1&limit=10
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
                data: await mergeFullNames(reports),
                pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            });
        } catch (error) {
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },

    // POST /weekly-reports/:deptId/submit
    submitReport: async (req, res) => {
        const { deptId } = req.params;
        const accountId = req.account._id;
        const { note = "" } = req.body;

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
        let oldFilePath = null;

        try {
            const weekStart = getWeekStart(new Date());
            const deadline = getDeadlineOfWeek(weekStart);

            let report = await WeeklyReportModel.findOne({ department: deptId, weekStart }).session(session);
            if (!report) {
                report = new WeeklyReportModel({ department: deptId, weekStart, deadline, status: "pending" });
            }

            if (report.file) {
                const oldFile = await InternalFileModel.findById(report.file).session(session);
                if (oldFile) {
                    oldFile.isDeleted = true;
                    await oldFile.save({ session });
                    oldFilePath = getInternalFilePath(oldFile.departmentCode, oldFile.subfolder, oldFile.filename);
                }
            }

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

            report.file = newFile._id;
            report.submittedAt = new Date();
            report.submittedBy = accountId;
            report.note = note;
            report.status = resolveStatus(report.status, deadline);
            await report.save({ session });

            await session.commitTransaction();

            if (oldFilePath && fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);

            await report.populate([
                { path: "file", select: "originalName mimeType size" },
                { path: "submittedBy", select: "username" },
                { path: "department", select: "department_name department_code" },
            ]);

            const [data] = await mergeFullNames([report]);

            return res.status(200).json({
                message: report.status === "late" ? "Nộp báo cáo thành công (trễ hạn)" : "Nộp báo cáo thành công",
                data,
            });
        } catch (error) {
            await session.abortTransaction();
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        } finally {
            session.endSession();
        }
    },

    // GET /weekly-reports/file/:reportId/view
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

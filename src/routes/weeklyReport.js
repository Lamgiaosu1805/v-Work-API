const express = require("express");
const router = express.Router();
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");
const { uploadWeeklyReport } = require("../middlewares/uploadWeeklyReport");
const WeeklyReportController = require("../controllers/WeeklyReportController");

// Trạng thái tuần hiện tại của phòng ban mình (?week=YYYY-MM-DD để xem tuần khác)
router.get("/my-dept", authenticate, WeeklyReportController.getMyDeptStatus);

// Admin: xem tất cả phòng ban trong tuần (?week=YYYY-MM-DD)
router.get("/admin", authenticate, isAdmin, WeeklyReportController.getAdminDashboard);

// Lịch sử nộp của 1 phòng ban (?page=1&limit=10)
router.get("/:deptId/history", authenticate, WeeklyReportController.getHistory);

// Nộp / nộp lại báo cáo
router.post("/:deptId/submit", authenticate, uploadWeeklyReport.single("file"), WeeklyReportController.submitReport);

// Xem file báo cáo
router.get("/file/:reportId/view", authenticate, WeeklyReportController.viewReportFile);

module.exports = router;

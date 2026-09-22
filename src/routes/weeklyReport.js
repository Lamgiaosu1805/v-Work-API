const express = require("express");

const router = express.Router();
const { authenticate, canManage } = require("../middlewares/authMiddleware");
const { uploadWeeklyReport } = require("../middlewares/uploadWeeklyReport");
const WeeklyReportController = require("../controllers/WeeklyReportController");

router.get("/my-departments", authenticate, WeeklyReportController.getMyDepartments);

router.get("/my-dept", authenticate, WeeklyReportController.getMyDeptStatus);

router.get(
  "/admin",
  authenticate,
  canManage("workplace"),
  WeeklyReportController.getAdminDashboard
);

router.get("/:deptId/history", authenticate, WeeklyReportController.getHistory);

router.post(
  "/:deptId/submit",
  authenticate,
  uploadWeeklyReport.single("file"),
  WeeklyReportController.submitReport
);

router.get("/file/:reportId/view", authenticate, WeeklyReportController.viewReportFile);

router.get("/file/:reportId/download", authenticate, WeeklyReportController.downloadReportFile);

module.exports = router;

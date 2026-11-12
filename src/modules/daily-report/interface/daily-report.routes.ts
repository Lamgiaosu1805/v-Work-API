import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { createRouter } from "../../../middlewares/validateObjectId";
import { dailyReportHttpController as c } from "./daily-report.http.controller";

// Báo cáo ngày kinh doanh — docs/CRM-DAILY-REPORT-FLOWS.md. Query chung: date=YYYY-MM-DD, app_code (mặc định tikluy).
const router = createRouter();

const canSubmit = requirePermission("daily_report.submit", "DailyReport");
const canView = requirePermission("daily_report.view", "DailyReport");

// Sale
router.get("/me", authenticate, canSubmit, asyncHandler(c.getMine));
router.put("/me/plan", authenticate, canSubmit, asyncHandler(c.savePlan));
router.put("/me/result", authenticate, canSubmit, asyncHandler(c.submitResult));

// Quản lý / lãnh đạo — bảng tổng hợp theo cây đơn vị, phạm vi theo data scope của daily_report.view
router.get("/summary", authenticate, canView, asyncHandler(c.getSummary));

export = router;

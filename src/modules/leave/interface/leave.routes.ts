import express from "express";
import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { leaveHttpController } from "./leave.http.controller";

const router = express.Router();

// Chỉ trả dữ liệu của chính người gọi (tra nhân viên theo tài khoản), nên chỉ cần đăng nhập — không cần requirePermission.
router.get("/my-overview", authenticate, asyncHandler(leaveHttpController.getMyOverview));
router.get("/my-ledger", authenticate, asyncHandler(leaveHttpController.getMyLedger));

export = router;

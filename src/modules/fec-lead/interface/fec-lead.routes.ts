import express from "express";
import verifyInternalRequest from "../../../middlewares/verifyInternalRequest";
import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { fecLeadHttpController } from "./fec-lead.http.controller";

const router = express.Router();

// Một chiều VNFITE → vWork, xác thực bằng API key nội bộ
router.post("/upsert", verifyInternalRequest, asyncHandler(fecLeadHttpController.upsert));

// Đọc cho người dùng CRM: lead thuộc khách nên theo quyền + phạm vi dữ liệu của customer.view
const canViewCustomer = requirePermission("customer.view", "Customer");
router.get("/leads", authenticate, canViewCustomer, asyncHandler(fecLeadHttpController.list));
// Xuất dữ liệu khách cần quyền riêng (Quy định 183A, Điều 11), phạm vi dữ liệu vẫn theo customer.view
router.get(
  "/leads/export",
  authenticate,
  requirePermission("customer.export", "Customer"),
  canViewCustomer,
  asyncHandler(fecLeadHttpController.export)
);
router.get(
  "/leads/:leadGenId/history",
  authenticate,
  canViewCustomer,
  asyncHandler(fecLeadHttpController.history)
);

export = router;

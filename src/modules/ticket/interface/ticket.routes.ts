import express from "express";
import { authenticate } from "../../../middlewares/authMiddleware";
import { uploadTicketFiles } from "../../../middlewares/uploadTicket";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { ticketHttpController } from "./ticket.http.controller";

const router = express.Router();

// Quyền ở route chỉ là "được vào loại thao tác nào"; quan hệ với TỪNG ticket (người tạo, chủ trì, người
// được giao, ticket hạn chế, file nhạy cảm) do domain kiểm tra lại ở mọi thao tác (domain/ticket-access.ts).
const guard = (action: string) => [authenticate, requirePermission(action, "Ticket")];
const view = guard("ticket.view");
const create = guard("ticket.create");
const handle = guard("ticket.handle");
const config = guard("ticket.config");

// ---- cấu hình + danh mục (đặt TRƯỚC các route /:id) -----------------------------------------
router.get("/meta", ...view, asyncHandler(ticketHttpController.meta));
router.get("/counts", ...view, asyncHandler(ticketHttpController.counts));
router.get("/search", ...view, asyncHandler(ticketHttpController.searchTickets));
router.get("/directory/employees", ...view, asyncHandler(ticketHttpController.searchEmployees));
router.get("/directory/departments", ...view, asyncHandler(ticketHttpController.listDepartments));

router.get("/config/settings", ...config, asyncHandler(ticketHttpController.settingsGet));
router.patch("/config/settings", ...config, asyncHandler(ticketHttpController.settingsUpdate));
router.get("/config/:kind", ...config, asyncHandler(ticketHttpController.configList));
router.post("/config/:kind", ...config, asyncHandler(ticketHttpController.configCreate));
router.patch("/config/:kind/:id", ...config, asyncHandler(ticketHttpController.configUpdate));
router.delete("/config/:kind/:id", ...config, asyncHandler(ticketHttpController.configRemove));

// ---- ticket ---------------------------------------------------------------------------------
router.get("/", ...view, asyncHandler(ticketHttpController.list));
router.post("/", ...create, uploadTicketFiles, asyncHandler(ticketHttpController.create));
router.get("/:id", ...view, asyncHandler(ticketHttpController.getById));
router.patch("/:id", ...view, asyncHandler(ticketHttpController.edit));
router.get(
  "/:id/attachments/:attachmentId/download",
  ...view,
  asyncHandler(ticketHttpController.downloadAttachment)
);

// Việc của người tạo
router.post("/:id/confirm", ...create, asyncHandler(ticketHttpController.confirm));
router.post("/:id/cancel", ...create, asyncHandler(ticketHttpController.cancel));
router.post("/:id/reopen", ...view, asyncHandler(ticketHttpController.reopen));
router.post(
  "/:id/submit-info",
  ...create,
  uploadTicketFiles,
  asyncHandler(ticketHttpController.submitInfo)
);

// Việc của nhóm xử lý
router.post("/:id/claim", ...handle, asyncHandler(ticketHttpController.claim));
router.post("/:id/release", ...handle, asyncHandler(ticketHttpController.release));
router.post("/:id/assign", ...view, asyncHandler(ticketHttpController.assign));
router.post("/:id/collaborators", ...handle, asyncHandler(ticketHttpController.addCollaborator));
router.delete(
  "/:id/collaborators/:employeeId",
  ...handle,
  asyncHandler(ticketHttpController.removeCollaborator)
);
router.post("/:id/request-info", ...handle, asyncHandler(ticketHttpController.requestInfo));
router.post("/:id/approval/verify", ...view, asyncHandler(ticketHttpController.verifyApproval));
router.post("/:id/hold", ...handle, asyncHandler(ticketHttpController.hold));
router.post("/:id/resume", ...handle, asyncHandler(ticketHttpController.resume));
router.post("/:id/resolve", ...handle, asyncHandler(ticketHttpController.resolve));
router.post("/:id/close", ...handle, asyncHandler(ticketHttpController.close));
router.post("/:id/due-hint", ...handle, asyncHandler(ticketHttpController.setDueHint));
router.post("/:id/links", ...handle, asyncHandler(ticketHttpController.linkRelated));

// Trao đổi: ai thấy ticket đầy đủ (và chưa kết thúc) đều nhắn được
router.post(
  "/:id/messages",
  ...view,
  uploadTicketFiles,
  asyncHandler(ticketHttpController.addMessage)
);

export = router;

const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const CustomerClaimRequestController = require("../controllers/CustomerClaimRequestController");

const router = express.Router();

// Sale gửi yêu cầu nhận khách (customer_claim_request.create)
router.post(
  "/",
  authenticate,
  requirePermission("customer_claim_request.create", "CustomerClaimRequest"),
  CustomerClaimRequestController.submit
);

// Sale xem yêu cầu của mình — dùng chung permission tạo (self-scoped, không cần quyền xem toàn bộ)
router.get(
  "/mine",
  authenticate,
  requirePermission("customer_claim_request.create", "CustomerClaimRequest"),
  CustomerClaimRequestController.listMine
);

// Admin/Manager xem toàn bộ yêu cầu
router.get(
  "/",
  authenticate,
  requirePermission("customer_claim_request.view", "CustomerClaimRequest"),
  CustomerClaimRequestController.list
);

// Admin/Manager phê duyệt hoặc từ chối
const canReviewClaimRequest = requirePermission(
  "customer_claim_request.review",
  "CustomerClaimRequest"
);
router.patch(
  "/:id/approve",
  authenticate,
  canReviewClaimRequest,
  CustomerClaimRequestController.approve
);
router.patch(
  "/:id/reject",
  authenticate,
  canReviewClaimRequest,
  CustomerClaimRequestController.reject
);

// Admin hủy phân công (nhận nhầm)
router.patch(
  "/:id/revoke",
  authenticate,
  requirePermission("customer_claim_request.revoke", "CustomerClaimRequest"),
  CustomerClaimRequestController.revoke
);

module.exports = router;

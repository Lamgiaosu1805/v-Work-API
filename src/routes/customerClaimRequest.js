const express = require("express");
const { authenticate, hasModuleAccess } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const CustomerClaimRequestController = require("../controllers/CustomerClaimRequestController");

const router = express.Router();

// Sale gửi yêu cầu nhận khách (CRM access)
router.post("/", authenticate, hasModuleAccess("crm"), CustomerClaimRequestController.submit);

// Sale xem yêu cầu của mình (CRM access)
router.get("/mine", authenticate, hasModuleAccess("crm"), CustomerClaimRequestController.listMine);

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

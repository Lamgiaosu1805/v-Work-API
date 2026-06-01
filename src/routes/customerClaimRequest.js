const express = require('express');
const { authenticate, hasModuleAccess, canManage } = require('../middlewares/authMiddleware');
const CustomerClaimRequestController = require('../controllers/CustomerClaimRequestController');
const router = express.Router();

// Sale gửi yêu cầu nhận khách (CRM access)
router.post("/", authenticate, hasModuleAccess("crm"), CustomerClaimRequestController.submit);

// Sale xem yêu cầu của mình (CRM access)
router.get("/mine", authenticate, hasModuleAccess("crm"), CustomerClaimRequestController.listMine);

// Admin/Manager xem toàn bộ yêu cầu (canManage CRM)
router.get("/", authenticate, canManage("crm"), CustomerClaimRequestController.list);

// Admin/Manager phê duyệt hoặc từ chối (canManage CRM)
router.patch("/:id/approve", authenticate, canManage("crm"), CustomerClaimRequestController.approve);
router.patch("/:id/reject", authenticate, canManage("crm"), CustomerClaimRequestController.reject);

// Admin hủy phân công (nhận nhầm) — chỉ admin
const { isAdmin } = require('../middlewares/authMiddleware');
router.patch("/:id/revoke", authenticate, isAdmin, CustomerClaimRequestController.revoke);

module.exports = router;

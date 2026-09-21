const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../core/authorization/require-permission.middleware');
const AiController = require('../controllers/AiController');

router.get(
  '/customer/:customerId/summary',
  authenticate,
  requirePermission('customer.ai_insight', 'Customer'),
  AiController.customerSummary
);
router.get(
  '/churn-risks',
  authenticate,
  requirePermission('customer.ai_insight', 'Customer'),
  AiController.getChurnRisks
);
router.post('/chat', authenticate, requirePermission('ai_chat.use', 'AiChat'), AiController.chat);

module.exports = router;

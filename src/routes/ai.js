const express = require('express');
const router = express.Router();
const { authenticate, hasModuleAccess } = require('../middlewares/authMiddleware');
const AiController = require('../controllers/AiController');

router.get('/customer/:customerId/summary', authenticate, hasModuleAccess('crm'), AiController.customerSummary);
router.get('/churn-risks', authenticate, hasModuleAccess('crm'), AiController.getChurnRisks);
router.post('/chat', authenticate, hasModuleAccess('crm'), AiController.chat);

module.exports = router;

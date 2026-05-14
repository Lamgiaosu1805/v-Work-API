const express = require('express');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const AdminCustomerController = require('../controllers/AdminCustomerController');

const router = express.Router();

router.get('/', authenticate, isAdmin, AdminCustomerController.list);

module.exports = router;
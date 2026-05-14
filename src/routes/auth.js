const express = require('express');
const AuthController = require('../controllers/AuthController');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
;
const router = express.Router()


//GET


//POST
router.post('/login', AuthController.login);
router.post('/changeFirstPassword', AuthController.changeFirstPassword);
router.post('/refreshToken', AuthController.refreshToken)
router.post('/logout', AuthController.logout)
router.post('/resetPassword', authenticate, isAdmin, AuthController.resetPassword)
router.patch('/set-permission/:accountId', authenticate, isAdmin, AuthController.setPermission)

module.exports = router;
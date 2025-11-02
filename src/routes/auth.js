const express = require('express');
const AuthController = require('../controllers/AuthController');
const router = express.Router()


//GET


//POST
router.post('/login', AuthController.login);
router.post('/changeFirstPassword', AuthController.changeFirstPassword);
router.post('/refreshToken', AuthController.refreshToken)

module.exports = router;
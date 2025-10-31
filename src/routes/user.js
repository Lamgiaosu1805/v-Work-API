const express = require('express');
const UserController = require('../controllers/UserController');
const router = express.Router()


//GET
router.get('/:userId', UserController.getUserInfo);

//POST
router.post('/', UserController.createUser);

module.exports = router;
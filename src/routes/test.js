const express = require('express');
const TestController = require('../controllers/TestController');
const router = express.Router()

router.get('/', TestController.index);

module.exports = router;
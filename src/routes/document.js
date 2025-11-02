const express = require('express');
const DocumentController = require('../controllers/DocumentController');
const { isAdmin, authenticate } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET
// router.get('/:userId', UserController.getUserInfo);

//POST
router.post('/createTypeDocument', authenticate, isAdmin, DocumentController.createTypeDocument);

module.exports = router;
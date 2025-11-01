const express = require('express');
const DocumentController = require('../controllers/DocumentController');
const { mockAdmin, isAdmin } = require('../middlewares/authMiddleware');
const router = express.Router()


//GET
// router.get('/:userId', UserController.getUserInfo);

//POST
router.post('/createTypeDocument', mockAdmin, isAdmin, DocumentController.createTypeDocument);

module.exports = router;
const express = require('express');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const CustomerController = require('../controllers/CustomerController');
const verifyInternalRequest = require('../middlewares/verifyInternalRequest');
const router = express.Router()


//GET


//POST
router.post("/upsert", verifyInternalRequest, CustomerController.upsert);



module.exports = router;
const express = require('express');
const { authenticate, isAdmin } = require('../middlewares/authMiddleware');
const CustomerController = require('../controllers/CustomerController');
const verifyInternalRequest = require('../middlewares/verifyInternalRequest');
const router = express.Router()


//GET
router.get("/my-customers", authenticate, CustomerController.getMyCustomers);
router.get("/agent-customers", verifyInternalRequest, CustomerController.getMyCustomersAsAgent);

//POST
router.post("/upsert", verifyInternalRequest, CustomerController.upsert);



module.exports = router;
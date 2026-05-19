const express = require("express");
const router = express.Router();
const LeaveRequestController = require("../controllers/LeaveRequestController");
const { authenticate, canManage } = require("../middlewares/authMiddleware");

router.post("/", authenticate, LeaveRequestController.create);
router.get("/my", authenticate, LeaveRequestController.getMyRequests);
router.get("/", authenticate, LeaveRequestController.getAll);
router.patch("/review/:id", authenticate, LeaveRequestController.review);
router.patch("/cancel/:id", authenticate, LeaveRequestController.cancel);

module.exports = router;

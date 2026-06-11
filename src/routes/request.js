const express = require("express");
const router = express.Router();
const RequestController = require("../controllers/RequestController");
const { authenticate } = require("../middlewares/authMiddleware");

router.get("/eligible-reviewers", authenticate, RequestController.getEligibleReviewers);
router.post("/", authenticate, RequestController.create);
router.get("/my", authenticate, RequestController.getMyRequests);
router.get("/", authenticate, RequestController.getAll);
router.patch("/review/:id", authenticate, RequestController.review);
router.patch("/cancel/:id", authenticate, RequestController.cancel);

module.exports = router;

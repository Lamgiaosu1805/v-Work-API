const express = require("express");
const RequestController = require("../../../controllers/RequestController");
const { authenticate } = require("../../../middlewares/authMiddleware");
const { asyncHandler } = require("../../../core/http/async-handler");
const { requestHttpController } = require("./request.http.controller");

const router = express.Router();

router.get(
  "/eligible-reviewers",
  authenticate,
  asyncHandler(requestHttpController.getEligibleReviewers)
);
router.get("/my", authenticate, asyncHandler(requestHttpController.getMyRequests));

router.get("/", authenticate, asyncHandler(requestHttpController.getAll));

router.post("/", authenticate, RequestController.create);
router.get("/:id", authenticate, RequestController.getById);
router.patch("/review/:id", authenticate, RequestController.review);
router.patch("/cancel/:id", authenticate, RequestController.cancel);

module.exports = router;

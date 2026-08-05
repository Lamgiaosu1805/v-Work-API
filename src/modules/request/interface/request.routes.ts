import express from "express";
import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requestHttpController } from "./request.http.controller";

const router = express.Router();

router.get(
  "/eligible-reviewers",
  authenticate,
  asyncHandler(requestHttpController.getEligibleReviewers)
);
router.get("/my", authenticate, asyncHandler(requestHttpController.getMyRequests));

router.get("/", authenticate, asyncHandler(requestHttpController.getAll));

router.get("/:id", authenticate, asyncHandler(requestHttpController.getById));

router.patch("/cancel/:id", authenticate, asyncHandler(requestHttpController.cancel));

router.post("/", authenticate, asyncHandler(requestHttpController.create));

router.patch("/review/:id", authenticate, asyncHandler(requestHttpController.review));

export = router;

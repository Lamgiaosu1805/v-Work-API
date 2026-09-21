import express from "express";
import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { requestHttpController } from "./request.http.controller";

const router = express.Router();

router.get(
  "/eligible-reviewers",
  authenticate,
  requirePermission("request.view", "Request"),
  asyncHandler(requestHttpController.getEligibleReviewers)
);
router.get(
  "/my",
  authenticate,
  requirePermission("request.view", "Request"),
  asyncHandler(requestHttpController.getMyRequests)
);

router.get(
  "/",
  authenticate,
  requirePermission("request.view", "Request"),
  asyncHandler(requestHttpController.getAll)
);

router.get(
  "/:id",
  authenticate,
  requirePermission("request.view", "Request"),
  asyncHandler(requestHttpController.getById)
);

router.patch(
  "/cancel/:id",
  authenticate,
  requirePermission("request.cancel", "Request"),
  asyncHandler(requestHttpController.cancel)
);

router.post(
  "/",
  authenticate,
  requirePermission("request.create", "Request"),
  asyncHandler(requestHttpController.create)
);

router.patch(
  "/review/:id",
  authenticate,
  requirePermission("request.review", "Request"),
  asyncHandler(requestHttpController.review)
);

export = router;

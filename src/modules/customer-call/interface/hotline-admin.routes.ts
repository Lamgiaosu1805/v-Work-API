import express from "express";
import { authenticate } from "../../../middlewares/authMiddleware";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { hotlineAdminHttpController } from "./hotline-admin.http.controller";

const router = express.Router();

router.get(
  "/admin/hotlines",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(hotlineAdminHttpController.getHotlines)
);

router.get(
  "/admin/hotline-call-scripts",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(hotlineAdminHttpController.getHotlineCallScripts)
);

router.get(
  "/admin/hotline-extensions",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(hotlineAdminHttpController.getHotlineExtensions)
);

router.get(
  "/admin/hotlines/:phone",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(hotlineAdminHttpController.getHotlineDetail)
);

router.patch(
  "/admin/hotlines/:phone",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(hotlineAdminHttpController.updateHotlineConfig)
);

router.post(
  "/admin/hotlines/:phone/sync-extension-assignments",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(hotlineAdminHttpController.syncHotlineExtensionAssignments)
);

export = router;

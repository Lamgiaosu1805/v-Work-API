import express from "express";
import { authenticate, isAdmin } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { hotlineAdminHttpController } from "./hotline-admin.http.controller";

const router = express.Router();

router.get(
  "/admin/hotlines",
  authenticate,
  isAdmin,
  asyncHandler(hotlineAdminHttpController.getHotlines)
);

router.get(
  "/admin/hotline-call-scripts",
  authenticate,
  isAdmin,
  asyncHandler(hotlineAdminHttpController.getHotlineCallScripts)
);

router.get(
  "/admin/hotline-extensions",
  authenticate,
  isAdmin,
  asyncHandler(hotlineAdminHttpController.getHotlineExtensions)
);

router.get(
  "/admin/hotlines/:phone",
  authenticate,
  isAdmin,
  asyncHandler(hotlineAdminHttpController.getHotlineDetail)
);

router.patch(
  "/admin/hotlines/:phone",
  authenticate,
  isAdmin,
  asyncHandler(hotlineAdminHttpController.updateHotlineConfig)
);

export = router;

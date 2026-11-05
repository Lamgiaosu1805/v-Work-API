import express from "express";
import { authenticate, isAdmin } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { appReleaseHttpController } from "./app-release.http.controller";

const router = express.Router();

router.get("/", asyncHandler(appReleaseHttpController.get));
router.post("/notify", authenticate, isAdmin, asyncHandler(appReleaseHttpController.notify));
router.put("/", authenticate, isAdmin, asyncHandler(appReleaseHttpController.update));

export = router;

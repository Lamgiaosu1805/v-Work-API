import express from "express";
import verifyInternalRequest from "../../../middlewares/verifyInternalRequest";
import { asyncHandler } from "../../../core/http/async-handler";
import { fecLeadHttpController } from "./fec-lead.http.controller";

const router = express.Router();

router.post("/upsert", verifyInternalRequest, asyncHandler(fecLeadHttpController.upsert));

export = router;

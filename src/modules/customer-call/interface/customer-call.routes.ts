import express from "express";
import { authenticate, isAdmin } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { customerCallWebhookHttpController } from "./customer-call-webhook.http.controller";
import { customerCallHttpController } from "./customer-call.http.controller";

const router = express.Router();

router.post(
  "/webhooks/omicall",
  asyncHandler(customerCallWebhookHttpController.receiveOmicallWebhook)
);

router.post(
  "/webhooks/omicall-events",
  asyncHandler(customerCallWebhookHttpController.receiveOmicallCallEvent)
);

router.post(
  "/webhooks/omicall-agent-transfer",
  asyncHandler(customerCallWebhookHttpController.receiveOmicallAgentTransferCallback)
);

router.get(
  "/sip-credentials",
  authenticate,
  requirePermission("customer_call.initiate", "SaleOmicallProfile"),
  asyncHandler(customerCallHttpController.getSipCredentials)
);

router.get(
  "/customers",
  authenticate,
  requirePermission("customer_call.view", "Customer"),
  asyncHandler(customerCallHttpController.getCustomersToCall)
);

router.patch(
  "/customers/:id/relationship-status",
  authenticate,
  requirePermission("customer_call.update_relationship_status", "Customer"),
  asyncHandler(customerCallHttpController.updateRelationshipStatus)
);

router.get(
  "/history",
  authenticate,
  requirePermission("call_log.view", "CallLog"),
  asyncHandler(customerCallHttpController.getCallHistory)
);

router.get(
  "/history/sale-options",
  authenticate,
  requirePermission("call_log.view", "CallLog"),
  asyncHandler(customerCallHttpController.getCallHistorySaleOptions)
);

router.patch(
  "/history/:id/note",
  authenticate,
  requirePermission("call_log.update_note", "CallLog"),
  asyncHandler(customerCallHttpController.updateCallLogNote)
);

router.post(
  "/reconcile",
  authenticate,
  isAdmin,
  asyncHandler(customerCallHttpController.reconcileCallHistory)
);

export = router;

import { Request, Response } from "express";
import {
  handleOmicallWebhook,
  OmicallWebhookPayload
} from "../application/handle-omicall-webhook.service";
import {
  handleOmicallCallEvent,
  OmicallCallEventPayload
} from "../application/handle-omicall-call-event.service";
import { handleOmicallAgentTransferCallback } from "../application/handle-omicall-agent-transfer-callback.service";

export const customerCallWebhookHttpController = {
  async receiveOmicallWebhook(req: Request, res: Response) {
    await handleOmicallWebhook(req.body as OmicallWebhookPayload);
    return res.status(200).json({ message: "OK" });
  },

  async receiveOmicallCallEvent(req: Request, res: Response) {
    await handleOmicallCallEvent(req.body as OmicallCallEventPayload);
    return res.status(200).json({ message: "OK" });
  },

  async receiveOmicallAgentTransferCallback(req: Request, res: Response) {
    await handleOmicallAgentTransferCallback(req.body);
    return res.status(200).json({ message: "OK" });
  }
};

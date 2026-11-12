import { Request, Response } from "express";
import { getMyLeaveLedger, getMyLeaveOverview } from "../../../workflows/get-my-leave.workflow";

export const leaveHttpController = {
  async getMyOverview(req: Request, res: Response) {
    const data = await getMyLeaveOverview(req.account!._id, req.query);
    return res.status(200).json({ message: "OK", data });
  },

  async getMyLedger(req: Request, res: Response) {
    const result = await getMyLeaveLedger(req.account!._id, req.query);
    return res.status(200).json({ message: "OK", ...result });
  }
};

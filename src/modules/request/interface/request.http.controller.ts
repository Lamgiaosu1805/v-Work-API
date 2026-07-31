import { Request, Response } from "express";
import { getEligibleReviewers } from "../application/get-eligible-reviewers.service";
import { getMyRequests } from "../application/get-my-requests.service";
import { getAllRequests } from "../application/get-all-requests.service";
import { getRequestById } from "../application/get-request-by-id.service";
import { cancelRequest } from "../application/cancel-request.service";
import { createRequest } from "../application/create-request.service";
import { reviewRequest } from "../application/review-request.service";

export const requestHttpController = {
  async getEligibleReviewers(req: Request, res: Response) {
    const reviewer = await getEligibleReviewers(req.account!._id);
    return res.status(200).json({ message: "OK", data: reviewer });
  },

  async getMyRequests(req: Request, res: Response) {
    const result = await getMyRequests(req.account!._id, req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getAll(req: Request, res: Response) {
    const result = await getAllRequests(req.account, req.query);
    return res.status(200).json({ message: "OK", ...result });
  },

  async getById(req: Request, res: Response) {
    const data = await getRequestById(req.account, req.params.id);
    return res.status(200).json({ message: "OK", data });
  },

  async cancel(req: Request, res: Response) {
    await cancelRequest(req.account, req.params.id);
    return res.status(200).json({ message: "Hủy đơn thành công" });
  },

  async create(req: Request, res: Response) {
    const entity = await createRequest(req.account, req.body);
    return res.status(201).json({ message: "Tạo đơn thành công", data: entity.getProps() });
  },

  async review(req: Request, res: Response) {
    const { action, reviewer_note } = req.body;
    const { entity, isFinal } = await reviewRequest(req.account, req.params.id, {
      action,
      reviewer_note
    });

    let message: string;
    if (!isFinal) {
      message = "Đã ghi nhận duyệt, đang chờ người duyệt tiếp theo";
    } else {
      message = action === "approve" ? "Đã duyệt đơn" : "Đã từ chối đơn";
    }

    return res.status(200).json({ message, data: entity.getProps() });
  }
};

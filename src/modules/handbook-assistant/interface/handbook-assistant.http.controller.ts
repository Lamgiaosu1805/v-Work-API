import { Request, Response } from "express";
import { listConversations } from "../application/list-conversations.service";
import { getConversationMessages } from "../application/get-conversation-messages.service";
import { deleteConversation } from "../application/delete-conversation.service";
import { submitFeedback } from "../application/submit-feedback.service";
import { getArticle } from "../application/get-article.service";
import { getQuota } from "../application/quota.service";
import { getSuggestions } from "../application/get-suggestions.service";

// Controller mỏng: map request → use-case → response `{ message, data }`. Lỗi do asyncHandler +
// errorHandlerMiddleware xử lý; quyền do requirePermission ở router.
export const handbookAssistantHttpController = {
  async listConversations(req: Request, res: Response) {
    const data = await listConversations(req.account!._id);
    return res.status(200).json({ message: "OK", data });
  },

  async getConversationMessages(req: Request, res: Response) {
    const data = await getConversationMessages(req.account!._id, req.params.id);
    return res.status(200).json({ message: "OK", data });
  },

  async deleteConversation(req: Request, res: Response) {
    await deleteConversation(req.account!._id, req.params.id);
    return res.status(200).json({ message: "Đã xoá hội thoại", data: null });
  },

  async submitFeedback(req: Request, res: Response) {
    const data = await submitFeedback({
      accountId: req.account!._id,
      messageId: req.params.id,
      value: req.body?.value,
      comment: req.body?.comment
    });
    return res.status(200).json({ message: "OK", data });
  },

  async getArticle(req: Request, res: Response) {
    const data = await getArticle(req.params.documentCode, req.params.idx);
    return res.status(200).json({ message: "OK", data });
  },

  async getQuota(req: Request, res: Response) {
    const data = await getQuota(req.account!._id);
    return res.status(200).json({ message: "OK", data });
  },

  async getSuggestions(_req: Request, res: Response) {
    const data = await getSuggestions();
    return res.status(200).json({ message: "OK", data });
  }
};

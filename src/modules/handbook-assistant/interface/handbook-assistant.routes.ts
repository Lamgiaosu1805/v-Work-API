import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { createRouter } from "../../../middlewares/validateObjectId";
import { handbookAssistantHttpController as c } from "./handbook-assistant.http.controller";

// REST của Trợ lý Nội quy (prefix /handbook-assistant). Phần hỏi/stream câu trả lời đi qua socket
// (`handbook:*`) vì gọi AI có thể lâu hơn timeout 30s của REST.
const router = createRouter();

const canUse = requirePermission("handbook_assistant.use", "HandbookAssistant");

router.get("/conversations", authenticate, canUse, asyncHandler(c.listConversations));
router.get(
  "/conversations/:id/messages",
  authenticate,
  canUse,
  asyncHandler(c.getConversationMessages)
);
router.delete("/conversations/:id", authenticate, canUse, asyncHandler(c.deleteConversation));
router.post("/messages/:id/feedback", authenticate, canUse, asyncHandler(c.submitFeedback));
router.get("/articles/:documentCode/:idx", authenticate, canUse, asyncHandler(c.getArticle));
router.get("/quota", authenticate, canUse, asyncHandler(c.getQuota));
router.get("/suggestions", authenticate, canUse, asyncHandler(c.getSuggestions));

export = router;

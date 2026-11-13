import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { createRouter } from "../../../middlewares/validateObjectId";
import { agentHarnessHttpController as c } from "./agent-harness.http.controller";

// REST của agent harness (prefix /ai-agents — khác /agents là đại lý). Quyền theo từng agent (`agent.<code>.use`)
// kiểm tra trong controller; câu hỏi / stream đi qua socket `agent:*`.
const router = createRouter();

router.get("/", authenticate, asyncHandler(c.listAgents));
router.get("/:code/conversations", authenticate, asyncHandler(c.listConversations));
router.get("/:code/conversations/:id/messages", authenticate, asyncHandler(c.getMessages));
router.delete("/:code/conversations/:id", authenticate, asyncHandler(c.deleteConversation));

export = router;

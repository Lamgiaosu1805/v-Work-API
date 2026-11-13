import mongoose from "mongoose";
import AgentConversationModel from "../../../models/AgentConversationModel";
import AgentMessageModel from "../../../models/AgentMessageModel";
import { AgentHarnessError } from "../domain/agent-harness.errors";

// Đọc / xoá hội thoại của CHÍNH người dùng (CQRS-lite, query thẳng model).
export async function listAgentConversations(accountId: string, agentCode: string) {
  const rows = (await AgentConversationModel.find({
    account: accountId,
    agent_code: agentCode,
    isDeleted: false
  })
    .sort({ last_message_at: -1 })
    .limit(50)
    .select("title last_message_at message_count")
    .lean()) as any[];
  return rows.map((c) => ({
    id: String(c._id),
    title: c.title,
    last_message_at: c.last_message_at,
    message_count: c.message_count
  }));
}

async function ownConversation(accountId: string, conversationId: string) {
  if (!mongoose.isValidObjectId(conversationId))
    throw new AgentHarnessError("CONVERSATION_NOT_FOUND");
  const conversation = await AgentConversationModel.findOne({
    _id: conversationId,
    account: accountId,
    isDeleted: false
  }).lean();
  if (!conversation) throw new AgentHarnessError("CONVERSATION_NOT_FOUND");
  return conversation as any;
}

export async function getAgentConversationMessages(accountId: string, conversationId: string) {
  const conversation = await ownConversation(accountId, conversationId);
  const messages = (await AgentMessageModel.find({ conversation: conversationId })
    .sort({ seq: 1 })
    .select("role content status error_code tool_calls.name createdAt")
    .lean()) as any[];
  return {
    conversation: {
      id: String(conversation._id),
      agent_code: conversation.agent_code,
      title: conversation.title
    },
    messages: messages.map((m) => ({
      id: String(m._id),
      role: m.role,
      content: m.content,
      status: m.status,
      error_code: m.error_code,
      tools: (m.tool_calls ?? []).map((t: any) => t.name),
      created_at: m.createdAt
    }))
  };
}

export async function deleteAgentConversation(
  accountId: string,
  conversationId: string
): Promise<void> {
  await ownConversation(accountId, conversationId);
  await AgentConversationModel.updateOne({ _id: conversationId }, { $set: { isDeleted: true } });
}

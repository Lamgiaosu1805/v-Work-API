import type { Request, Response } from "express";
import { canEmployee } from "../../../core/authorization/can-employee";
import { resolveEmployeeId } from "../../../core/authorization/resolve-employee-id";
import { ForbiddenException, NotFoundException } from "../../../core/exceptions/exceptions";
import { getAgent, listAgents } from "../application/agent-registry";
import { getAgentRuntimeConfig } from "../application/agent-harness.config";
import {
  deleteAgentConversation,
  getAgentConversationMessages,
  listAgentConversations
} from "../application/conversation-queries.service";
import { getAgentQuota } from "../application/quota.service";
import { AgentHarnessError } from "../domain/agent-harness.errors";

const accountIdOf = (req: Request) => String((req as any).account._id);

async function usableAgents(req: Request) {
  const employeeId = await resolveEmployeeId(accountIdOf(req));
  const result = [];
  for (const agent of listAgents()) {
    if (await canEmployee(employeeId, agent.permission.action, agent.permission.subject))
      result.push(agent);
  }
  return result;
}

async function requireAgent(req: Request) {
  const agent = getAgent(req.params.code);
  if (!agent) throw new NotFoundException("Trợ lý không tồn tại");
  const employeeId = await resolveEmployeeId(accountIdOf(req));
  if (!(await canEmployee(employeeId, agent.permission.action, agent.permission.subject))) {
    throw new ForbiddenException("Bạn không có quyền dùng trợ lý này");
  }
  return agent;
}

const mapError = (error: unknown) => {
  if (error instanceof AgentHarnessError && error.errorCode === "CONVERSATION_NOT_FOUND") {
    return new NotFoundException(error.message);
  }
  return error;
};

export const agentHarnessHttpController = {
  // Agent người dùng được dùng + hạn mức hôm nay
  async listAgents(req: Request, res: Response) {
    const agents = await usableAgents(req);
    const data = await Promise.all(
      agents.map(async (agent) => ({
        code: agent.code,
        name: agent.name,
        description: agent.description,
        suggestions: agent.suggestions,
        quota: await getAgentQuota(
          accountIdOf(req),
          agent.code,
          getAgentRuntimeConfig(agent).dailyQuota
        )
      }))
    );
    return res.status(200).json({ message: "OK", data });
  },

  async listConversations(req: Request, res: Response) {
    const agent = await requireAgent(req);
    return res
      .status(200)
      .json({ message: "OK", data: await listAgentConversations(accountIdOf(req), agent.code) });
  },

  async getMessages(req: Request, res: Response) {
    await requireAgent(req);
    try {
      const data = await getAgentConversationMessages(accountIdOf(req), String(req.params.id));
      return res.status(200).json({ message: "OK", data });
    } catch (error) {
      throw mapError(error);
    }
  },

  async deleteConversation(req: Request, res: Response) {
    await requireAgent(req);
    try {
      await deleteAgentConversation(accountIdOf(req), String(req.params.id));
      return res.status(200).json({ message: "Đã xoá hội thoại" });
    } catch (error) {
      throw mapError(error);
    }
  }
};

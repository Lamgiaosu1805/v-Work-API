// Public API của agent harness (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 5).
export type {
  AgentDefinition,
  AgentEffort,
  AgentRunContext,
  AgentToolSpec
} from "./domain/agent-definition";
export { registerAgent, getAgent, listAgents } from "./application/agent-registry";
export { recoverStaleAgentRuns } from "./application/ask-agent.service";
export {
  setupAgentHarnessSocket,
  shutdownAgentHarness,
  AGENT_SOCKET_EVENTS
} from "./interface/agent-harness.socket";

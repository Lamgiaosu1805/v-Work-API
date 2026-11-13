import type { AgentDefinition } from "../domain/agent-definition";

// Danh sách agent đăng ký lúc khởi động (index.js gọi registerAgent từ tầng workflows/).
const agents = new Map<string, AgentDefinition>();

export function registerAgent(definition: AgentDefinition): void {
  agents.set(definition.code, definition);
}

export function getAgent(code: unknown): AgentDefinition | null {
  return typeof code === "string" ? (agents.get(code) ?? null) : null;
}

export function listAgents(): AgentDefinition[] {
  return [...agents.values()];
}

/** Chỉ dùng trong test. */
export function clearAgentsForTest(): void {
  agents.clear();
}

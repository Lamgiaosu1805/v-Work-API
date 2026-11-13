import type { AgentDefinition, AgentEffort } from "../domain/agent-definition";

// Cấu hình theo agent, đọc env mỗi lần dùng để đổi model/effort/hạn mức không cần deploy lại code.
const EFFORTS: AgentEffort[] = ["low", "medium", "high", "xhigh", "max"];

export interface AgentRuntimeConfig {
  apiKey: string;
  model: string;
  effort: AgentEffort;
  dailyQuota: number;
}

/**
 * Khoá Claude API dùng chung cho mọi agent: AGENT_ANTHROPIC_API_KEY → khoá của Trợ lý Nội quy (đang chạy trên cả test
 * lẫn live) → ANTHROPIC_API_KEY.
 */
export const getAgentApiKey = (): string =>
  process.env.AGENT_ANTHROPIC_API_KEY ||
  process.env.HANDBOOK_ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  "";

export function getAgentRuntimeConfig(agent: AgentDefinition): AgentRuntimeConfig {
  const effortEnv = process.env[agent.effort.env] as AgentEffort | undefined;
  const quotaEnv = Number(process.env[`${agent.envPrefix}_DAILY_QUOTA`]);
  return {
    apiKey: getAgentApiKey(),
    model: process.env[agent.model.env] || agent.model.default,
    effort: effortEnv && EFFORTS.includes(effortEnv) ? effortEnv : agent.effort.default,
    dailyQuota: Number.isFinite(quotaEnv) && quotaEnv > 0 ? quotaEnv : agent.dailyQuota
  };
}

export const MAX_QUESTION_LENGTH = 2000;
/** Số tin nhắn gần nhất của hội thoại gửi kèm làm ngữ cảnh. */
export const HISTORY_MESSAGES = 10;
/** Không có hoạt động từ model quá lâu → huỷ (model + công cụ). */
export const IDLE_TIMEOUT_MS = 120_000;
/** Khoá chống hỏi trùng giữa các tiến trình (deploy chồng). */
export const BUSY_LOCK_TTL_MS = 5 * 60_000;

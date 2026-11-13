// Định nghĩa 1 agent của agent harness (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 5): mỗi agent = system prompt
// cố định + bộ công cụ chỉ đọc + model/effort + quyền + hạn mức. Agent cụ thể (vd `sales-bi`) khai ở src/workflows/agents/
// vì công cụ của nó đọc nhiều module; harness chỉ biết hợp đồng dưới đây.

export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Người hỏi — luôn lấy từ phiên đã xác thực, không bao giờ từ nội dung câu hỏi. */
export interface AgentRunContext {
  accountId: string;
  employeeId: string;
  now: Date;
}

export interface AgentToolSpec {
  name: string;
  description: string;
  /** JSON Schema dạng strict: mọi object có additionalProperties: false, mọi thuộc tính nằm trong required. */
  inputSchema: Record<string, unknown>;
  /** Chỉ đọc, tự áp phạm vi quyền của người hỏi. Lỗi ném ra được trả về model dưới dạng tool_result is_error. */
  run(input: Record<string, unknown>, ctx: AgentRunContext): Promise<unknown>;
}

export interface AgentDefinition {
  code: string;
  name: string;
  description: string;
  permission: { action: string; subject: string };
  /** Cố định giữa các câu hỏi để được prompt caching — KHÔNG đặt ngày giờ / tên người hỏi ở đây. */
  systemPrompt: string;
  /** Ngữ cảnh động (ngày giờ, người hỏi, phạm vi) — đặt ở đầu tin nhắn người dùng. */
  buildContext?(ctx: AgentRunContext): Promise<string>;
  tools: AgentToolSpec[];
  model: { env: string; default: string };
  effort: { env: string; default: AgentEffort };
  maxTokens: number;
  /** Số vòng gọi công cụ tối đa cho 1 câu hỏi. */
  maxToolRounds: number;
  /** Số câu hỏi / ngày / tài khoản (env `${envPrefix}_DAILY_QUOTA` ghi đè). */
  dailyQuota: number;
  envPrefix: string;
  suggestions: string[];
}

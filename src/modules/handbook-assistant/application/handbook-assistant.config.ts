// Cấu hình Trợ lý Nội quy đọc từ env — đọc lại ở MỖI lần gọi (không cache ở mức module) để đổi
// được giá trị mà không phải khởi động lại tiến trình trong test; chi phí đọc env là không đáng kể.

export type AiEffort = "low" | "medium" | "high";
export type CacheTtl = "5m" | "1h";

export interface HandbookAssistantConfig {
  // --- Gọi AI ---
  // HANDBOOK_ANTHROPIC_API_KEY (nên dùng key/workspace riêng để tách chi phí), rơi về ANTHROPIC_API_KEY.
  anthropicApiKey: string;
  model: string;
  effort: AiEffort;
  // Trần output — thinking cũng tính vào đây.
  maxTokens: number;
  // TTL cache cho phần văn bản nội quy (dùng chung cả công ty).
  cacheTtl: CacheTtl;
  // --- Giới hạn sử dụng ---
  // Số câu hỏi tối đa của một tài khoản trong một ngày (giờ VN).
  dailyQuota: number;
  // Số lượt hỏi tối đa trong một hội thoại.
  maxTurns: number;
  // Số câu trả lời chạy đồng thời tối đa trên toàn server.
  maxConcurrent: number;
  // Hội thoại không hoạt động quá số ngày này bị xoá hẳn.
  retentionDays: number;
  // --- Thời hạn (ms) ---
  // Không nhận được sự kiện nào từ nhà cung cấp quá lâu → coi là treo (web báo NETWORK sau 90s).
  streamIdleMs: number;
  // Chưa có chữ đầu tiên sau chừng này → bỏ cuộc (phải nhỏ hơn 90s của web).
  firstTextMs: number;
  // Tổng thời gian tối đa của một câu trả lời.
  maxDurationMs: number;
  // Xử lý trước khi ack (kiểm tra + lưu) quá chừng này → huỷ lượt hỏi và hoàn hạn mức, vì web đã
  // bỏ cuộc sau 15s.
  ackDeadlineMs: number;
}

const DEFAULTS = {
  model: "claude-haiku-5-5",
  effort: "medium" as AiEffort,
  maxTokens: 8000,
  cacheTtl: "1h" as CacheTtl,
  dailyQuota: 30,
  maxTurns: 20,
  maxConcurrent: 10,
  retentionDays: 180,
  streamIdleMs: 60_000,
  firstTextMs: 75_000,
  maxDurationMs: 180_000,
  ackDeadlineMs: 10_000
};

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function getHandbookAssistantConfig(): HandbookAssistantConfig {
  const { env } = process;
  return {
    anthropicApiKey: (env.HANDBOOK_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || "").trim(),
    model: (env.HANDBOOK_AI_MODEL || "").trim() || DEFAULTS.model,
    effort: oneOf(env.HANDBOOK_AI_EFFORT, ["low", "medium", "high"], DEFAULTS.effort),
    maxTokens: positiveInteger(env.HANDBOOK_AI_MAX_TOKENS, DEFAULTS.maxTokens),
    cacheTtl: oneOf(env.HANDBOOK_CACHE_TTL, ["5m", "1h"], DEFAULTS.cacheTtl),
    dailyQuota: positiveInteger(env.HANDBOOK_DAILY_QUOTA, DEFAULTS.dailyQuota),
    maxTurns: positiveInteger(env.HANDBOOK_MAX_TURNS, DEFAULTS.maxTurns),
    maxConcurrent: positiveInteger(env.HANDBOOK_MAX_CONCURRENT, DEFAULTS.maxConcurrent),
    retentionDays: positiveInteger(env.HANDBOOK_RETENTION_DAYS, DEFAULTS.retentionDays),
    streamIdleMs: positiveInteger(env.HANDBOOK_STREAM_IDLE_MS, DEFAULTS.streamIdleMs),
    firstTextMs: positiveInteger(env.HANDBOOK_FIRST_TEXT_MS, DEFAULTS.firstTextMs),
    maxDurationMs: positiveInteger(env.HANDBOOK_MAX_DURATION_MS, DEFAULTS.maxDurationMs),
    ackDeadlineMs: positiveInteger(env.HANDBOOK_ACK_DEADLINE_MS, DEFAULTS.ackDeadlineMs)
  };
}

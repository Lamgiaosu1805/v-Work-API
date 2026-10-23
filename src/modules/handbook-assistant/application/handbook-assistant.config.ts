// Cấu hình Trợ lý Nội quy đọc từ env — đọc lại ở MỖI lần gọi (không cache ở mức module) để đổi
// được hạn mức mà không phải khởi động lại tiến trình trong test; chi phí đọc env là không đáng kể.

export interface HandbookAssistantConfig {
  // Số câu hỏi tối đa của một tài khoản trong một ngày (giờ VN).
  dailyQuota: number;
}

const DEFAULT_DAILY_QUOTA = 30;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getHandbookAssistantConfig(): HandbookAssistantConfig {
  return {
    dailyQuota: positiveInteger(process.env.HANDBOOK_DAILY_QUOTA, DEFAULT_DAILY_QUOTA)
  };
}

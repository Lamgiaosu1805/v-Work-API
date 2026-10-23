import type { AnswerUsage } from "../../application/ports/handbook-answerer.port";

// Giá ƯỚC TÍNH (USD / 1 triệu token) để ghi log chi phí — theo bảng giá công bố tại thời điểm viết
// (10/2026). Đổi model hoặc khi giá đổi thì cập nhật bảng này; model không có trong bảng → chi phí
// được ghi là null (không đoán).
interface ModelPrice {
  input: number;
  output: number;
  // Hệ số so với giá input
  cacheReadMultiplier: number;
  // Một số model tính giá cao hơn khi prompt dài (Haiku 5.5: trên 100K token).
  longPrompt?: { threshold: number; input: number; output: number };
}

const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheReadMultiplier: 0.1,
    longPrompt: { threshold: 100_000, input: 0.5, output: 2.5 }
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheReadMultiplier: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheReadMultiplier: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheReadMultiplier: 0.05 },
  "claude-opus-5": { input: 5, output: 25, cacheReadMultiplier: 0.1 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheReadMultiplier: 0.1 }
};

export function estimateCostUsd(model: string, usage: AnswerUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;

  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
  const tier =
    price.longPrompt && promptTokens > price.longPrompt.threshold ? price.longPrompt : price;

  const perToken = 1 / 1_000_000;
  const cost =
    (usage.input * tier.input +
      usage.cacheRead * tier.input * price.cacheReadMultiplier +
      usage.cacheWrite5m * tier.input * CACHE_WRITE_5M_MULTIPLIER +
      usage.cacheWrite1h * tier.input * CACHE_WRITE_1H_MULTIPLIER +
      usage.output * tier.output) *
    perToken;
  // Làm tròn 6 chữ số thập phân (1 phần triệu USD) cho gọn khi lưu/hiển thị.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

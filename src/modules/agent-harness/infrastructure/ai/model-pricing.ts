import type { AgentUsage } from "../../application/ports/agent-model.port";

// Giá ƯỚC TÍNH (USD / 1 triệu token) để ghi log chi phí — theo bảng giá công bố (11/2026). Model không có trong
// bảng → chi phí null (không đoán). Giữ đồng bộ với handbook-assistant/infrastructure/ai/model-pricing.ts.
interface ModelPrice {
  input: number;
  output: number;
  cacheReadMultiplier: number;
}

const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheReadMultiplier: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheReadMultiplier: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheReadMultiplier: 0.05 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheReadMultiplier: 0.1 }
};

export function estimateCostUsd(model: string, usage: AgentUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const cost =
    (usage.input * price.input +
      usage.cacheRead * price.input * price.cacheReadMultiplier +
      usage.cacheWrite5m * price.input * CACHE_WRITE_5M_MULTIPLIER +
      usage.cacheWrite1h * price.input * CACHE_WRITE_1H_MULTIPLIER +
      usage.output * price.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

import moment from "moment-timezone";
import AgentUsageModel from "../../../models/AgentUsageModel";
import { DateKey } from "../../../shared-kernel/date-key";
import { AgentHarnessError } from "../domain/agent-harness.errors";
import type { AgentUsage } from "./ports/agent-model.port";

// Hạn mức câu hỏi / ngày (giờ VN) theo tài khoản + agent. Giữ lượt nguyên tử (upsert rồi tăng có điều kiện), hoàn
// lượt khi câu trả lời hỏng trước khi người dùng nhận được chữ nào.
const TZ = "Asia/Ho_Chi_Minh";

export interface QuotaView {
  limit: number;
  used: number;
  remaining: number;
  resetAt: Date;
}

export async function getAgentQuota(
  accountId: string,
  agentCode: string,
  limit: number,
  now: Date = new Date()
): Promise<QuotaView> {
  const usage = (await AgentUsageModel.findOne({
    account: accountId,
    agent_code: agentCode,
    date_key: DateKey.from(now).toString()
  })
    .select("used")
    .lean()) as { used?: number } | null;
  const used = usage?.used ?? 0;
  return {
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    resetAt: moment.tz(now, TZ).add(1, "day").startOf("day").toDate()
  };
}

export async function reserveAgentQuota(
  accountId: string,
  agentCode: string,
  limit: number,
  now: Date = new Date()
): Promise<string> {
  const dateKey = DateKey.from(now).toString();
  const key = { account: accountId, agent_code: agentCode, date_key: dateKey };
  await AgentUsageModel.updateOne(key, { $setOnInsert: { used: 0 } }, { upsert: true });
  const updated = await AgentUsageModel.findOneAndUpdate(
    { ...key, used: { $lt: limit } },
    { $inc: { used: 1 } },
    { new: true }
  ).lean();
  if (!updated) throw new AgentHarnessError("QUOTA_EXCEEDED");
  return dateKey;
}

export async function refundAgentQuota(
  accountId: string,
  agentCode: string,
  dateKey: string
): Promise<void> {
  await AgentUsageModel.updateOne(
    { account: accountId, agent_code: agentCode, date_key: dateKey, used: { $gt: 0 } },
    { $inc: { used: -1 } }
  );
}

export async function recordAgentUsage(
  accountId: string,
  agentCode: string,
  dateKey: string,
  usage: AgentUsage,
  costUsd: number | null
): Promise<void> {
  await AgentUsageModel.updateOne(
    { account: accountId, agent_code: agentCode, date_key: dateKey },
    {
      $inc: {
        input_tokens: usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h,
        output_tokens: usage.output,
        cost_usd: costUsd ?? 0
      }
    }
  );
}

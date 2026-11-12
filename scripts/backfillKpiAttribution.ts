import "dotenv/config";
import mongoose from "mongoose";
import AgentModel from "../src/models/AgentModel";
import AppModel from "../src/models/AppModel";
import CustomerModel from "../src/models/CustomerModel";
import InvestmentModel from "../src/models/InvestmentModel";
import { resolveSaleUnitIds } from "../src/helpers/kpiAttribution";

// Backfill ghi nhận KPI cho dữ liệu cũ (docs/CRM-DAILY-REPORT-FLOWS.md R6) — chỉ ghi vào bản ghi CHƯA có ghi nhận.
//   CIF: theo HH CIF (cif_commission); khách đại lý chưa có HH → Sale phụ trách đại lý hiện tại.
//   Đầu tư: commission.sale_id → referred_by hiện tại → Sale phụ trách đại lý → "Chưa phân bổ".
//   TTKD = TTKD hiện tại của Sale (dữ liệu cũ không có lịch sử điều chuyển).
// Gán Sale phụ trách cho đại lý TRƯỚC khi chạy. Chạy thử: --dry-run.
// Chạy: npx ts-node --transpile-only scripts/backfillKpiAttribution.ts --app=tikluy [--dry-run]

const args = process.argv.slice(2);
const APP_CODE = args.find((a) => a.startsWith("--app="))?.split("=")[1] ?? "tikluy";
const DRY_RUN = args.includes("--dry-run");
const BATCH = 500;

type Counter = Map<string, number>;
const bump = (counter: Counter, key: string) => counter.set(key, (counter.get(key) ?? 0) + 1);

async function flush(model: mongoose.Model<any>, ops: any[]): Promise<void> {
  if (!ops.length || DRY_RUN) return;
  await model.bulkWrite(ops, { ordered: false });
}

async function backfillCustomers(appId: mongoose.Types.ObjectId): Promise<void> {
  const customers = (await CustomerModel.find({
    app_id: appId,
    isDeleted: false,
    kpi_cif: null,
    $or: [{ "cif_commission.sale_id": { $ne: null } }, { agent_id: { $ne: null } }]
  })
    .select("cif_commission agent_id registeredAt")
    .lean()) as any[];

  const agentIds = [...new Set(customers.filter((c) => c.agent_id).map((c) => String(c.agent_id)))];
  const agents = (await AgentModel.find({ _id: { $in: agentIds } })
    .select("manager_sale_id")
    .lean()) as any[];
  const agentSale = new Map(agents.map((a) => [String(a._id), a.manager_sale_id ?? null]));

  const saleIdOf = (c: any) =>
    c.cif_commission?.sale_id ?? (c.agent_id ? agentSale.get(String(c.agent_id)) : null) ?? null;
  const units = await resolveSaleUnitIds(customers.map(saleIdOf).filter(Boolean));

  const byChannel: Counter = new Map();
  let ops: any[] = [];
  for (const c of customers) {
    const hasCommission = !!c.cif_commission?.sale_id;
    // HH CIF tự gán lúc đăng ký thì granted_by = null; có người duyệt = yêu cầu nhận khách
    let channel = "agent";
    if (hasCommission) channel = c.cif_commission.granted_by ? "claim" : "sale_ref";
    const saleId = saleIdOf(c);
    bump(byChannel, saleId ? channel : `${channel} (chưa có Sale)`);
    ops.push({
      updateOne: {
        filter: { _id: c._id, kpi_cif: null },
        update: {
          $set: {
            kpi_cif: {
              sale_id: saleId,
              department_id: saleId ? (units.get(String(saleId)) ?? null) : null,
              agent_id: c.agent_id ?? null,
              channel,
              at: (hasCommission && c.cif_commission.granted_at) || c.registeredAt
            }
          }
        }
      }
    });
    if (ops.length >= BATCH) {
      await flush(CustomerModel, ops);
      ops = [];
    }
  }
  await flush(CustomerModel, ops);
  console.log(`CIF: ${customers.length} khách cần ghi nhận`, Object.fromEntries(byChannel));
}

async function backfillInvestments(appId: mongoose.Types.ObjectId): Promise<void> {
  const investments = (await InvestmentModel.find({
    app_id: appId,
    isDeleted: false,
    kpi_attribution: null
  })
    .select("customer_id commission.sale_id invested_at")
    .lean()) as any[];

  const customers = (await CustomerModel.find({
    _id: { $in: [...new Set(investments.map((i) => String(i.customer_id)))] }
  })
    .select("referred_by agent_id")
    .lean()) as any[];
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  const agentIds = [...new Set(customers.filter((c) => c.agent_id).map((c) => String(c.agent_id)))];
  const agents = (await AgentModel.find({ _id: { $in: agentIds } })
    .select("manager_sale_id")
    .lean()) as any[];
  const agentSale = new Map(agents.map((a) => [String(a._id), a.manager_sale_id ?? null]));

  const resolve = (inv: any) => {
    const customer = customerById.get(String(inv.customer_id));
    const agentId = customer?.agent_id ?? null;
    const saleId = inv.commission?.sale_id ?? customer?.referred_by ?? null;
    if (saleId) return { saleId, agentId, channel: "sale" };
    const agentSaleId = agentId ? agentSale.get(String(agentId)) : null;
    if (agentSaleId) return { saleId: agentSaleId, agentId, channel: "agent" };
    return { saleId: null, agentId, channel: "unassigned" };
  };
  const resolved = investments.map((inv) => ({ inv, ...resolve(inv) }));
  const units = await resolveSaleUnitIds(resolved.map((r) => r.saleId).filter(Boolean));

  const byChannel: Counter = new Map();
  let ops: any[] = [];
  for (const { inv, saleId, agentId, channel } of resolved) {
    bump(byChannel, channel);
    ops.push({
      updateOne: {
        filter: { _id: inv._id, kpi_attribution: null },
        update: {
          $set: {
            kpi_attribution: {
              sale_id: saleId,
              department_id: saleId ? (units.get(String(saleId)) ?? null) : null,
              agent_id: agentId,
              channel,
              attributed_at: inv.invested_at
            }
          }
        }
      }
    });
    if (ops.length >= BATCH) {
      await flush(InvestmentModel, ops);
      ops = [];
    }
  }
  await flush(InvestmentModel, ops);
  console.log(`Đầu tư: ${investments.length} khoản cần ghi nhận`, Object.fromEntries(byChannel));
}

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log(`✅ Kết nối MongoDB thành công${DRY_RUN ? " — CHẠY THỬ, không ghi" : ""}\n`);

  const app = (await AppModel.findOne({ code: APP_CODE }).select("_id").lean()) as any;
  if (!app) throw new Error(`Không tìm thấy app "${APP_CODE}"`);

  await backfillCustomers(app._id);
  await backfillInvestments(app._id);

  await mongoose.disconnect();
  console.log(`\n🎉 Xong${DRY_RUN ? " (chạy thử)" : ""}`);
}

main().catch((err) => {
  console.error("❌ Lỗi:", err);
  process.exit(1);
});

import AppModel from "../models/AppModel";
import CustomerModel from "../models/CustomerModel";
import InvestmentModel from "../models/InvestmentModel";
import { getInvestmentHoldings } from "../utils/tikluyClient";
import { buildInvestmentAttribution } from "../helpers/kpiAttribution";
import { mapWithConcurrency } from "../core/async/map-with-concurrency";
import {
  ClosureRecord,
  HoldingRow,
  findRenewalTarget,
  holdingKeys,
  mapHoldingClosure
} from "./investment-closure/holding-mapper";

// Đồng bộ tất toán / tái tục từ danh mục đầu tư TIKLUY (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 3, Q1–Q3).
// Chỉ ghi `closure` / `closure_attribution` / `renewal_of` phục vụ KPI (tiền ra, tăng net, AUM, tái tục) —
// KHÔNG đổi `status` và hoa hồng của khoản đầu tư (luồng hoa hồng vẫn theo /investments/upsert của TIKLUY).

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

export interface ClosureSyncOptions {
  appCode: string;
  now?: Date;
  dryRun?: boolean;
  concurrency?: number;
  limitCustomers?: number;
  fetchHoldings?: (externalId: string) => Promise<HoldingRow[]>;
}

export interface ClosureSyncResult {
  customers: number;
  synced: number;
  closed: number;
  renewed: number;
  renewalLinks: number;
  unknownCodes: number;
  errors: { external_id: string; message: string }[];
}

async function fetchAllHoldings(externalId: string): Promise<HoldingRow[]> {
  const rows: HoldingRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows: batch, total } = await getInvestmentHoldings(externalId, {
      pageNumber: page,
      pageSize: PAGE_SIZE
    });
    rows.push(...batch);
    if (!batch.length || rows.length >= total) break;
  }
  return rows;
}

export async function syncInvestmentClosures(
  options: ClosureSyncOptions
): Promise<ClosureSyncResult> {
  const now = options.now ?? new Date();
  const fetchHoldings = options.fetchHoldings ?? fetchAllHoldings;
  const app = (await AppModel.findOne({ code: options.appCode }).select("_id").lean()) as any;
  if (!app) throw new Error(`Không tìm thấy app "${options.appCode}"`);

  // Chỉ khách còn khoản chưa ghi nhận tất toán mới cần hỏi TIKLUY
  const open = (await InvestmentModel.find({
    app_id: app._id,
    isDeleted: false,
    status: { $ne: "cancelled" },
    closure: null
  })
    .select("_id customer_id external_investment_id")
    .lean()) as any[];
  const openByCustomer = new Map<string, any[]>();
  open.forEach((inv) => {
    const key = String(inv.customer_id);
    if (!openByCustomer.has(key)) openByCustomer.set(key, []);
    openByCustomer.get(key)!.push(inv);
  });

  let customerIds = [...openByCustomer.keys()];
  if (options.limitCustomers) customerIds = customerIds.slice(0, options.limitCustomers);
  const customers = (await CustomerModel.find({ _id: { $in: customerIds } })
    .select("external_id referred_by agent_id")
    .lean()) as any[];

  const result: ClosureSyncResult = {
    customers: customers.length,
    synced: 0,
    closed: 0,
    renewed: 0,
    renewalLinks: 0,
    unknownCodes: 0,
    errors: []
  };

  await mapWithConcurrency(customers, options.concurrency ?? 3, async (customer) => {
    if (!customer.external_id) return;
    try {
      const rows = await fetchHoldings(customer.external_id);
      const openInvs = openByCustomer.get(String(customer._id)) ?? [];
      const byCode = new Map(openInvs.map((inv) => [String(inv.external_investment_id), inv]));

      const closures: { inv: any; closure: ClosureRecord }[] = [];
      const unmatched: string[] = [];
      rows.forEach((row) => {
        const closure = mapHoldingClosure(row, now);
        const keys = holdingKeys(row);
        const inv = keys.map((key) => byCode.get(key)).find(Boolean);
        if (!inv) {
          if (closure) unmatched.push(...keys);
          return;
        }
        if (closure) closures.push({ inv, closure });
      });
      if (unmatched.length) {
        // Khoản đã ghi nhận tất toán từ lần trước không phải mã lạ
        const known = (await InvestmentModel.find({
          app_id: app._id,
          external_investment_id: { $in: unmatched }
        })
          .select("external_investment_id")
          .lean()) as any[];
        const knownCodes = new Set(known.map((k) => String(k.external_investment_id)));
        const unknownRows = rows.filter((row) => {
          const keys = holdingKeys(row);
          return (
            mapHoldingClosure(row, now) &&
            !keys.some((key) => byCode.has(key) || knownCodes.has(key))
          );
        });
        result.unknownCodes += unknownRows.length;
      }

      const ops: any[] = [];
      if (closures.length) {
        // Tiền ra trừ vào Sale đang giữ khách lúc tất toán (≈ lúc đồng bộ hằng đêm) — Q2
        const attribution = await buildInvestmentAttribution(customer, null, now);
        const pool = (await InvestmentModel.find({
          customer_id: customer._id,
          isDeleted: false,
          status: { $ne: "cancelled" },
          renewal_of: null
        })
          .select("_id amount invested_at")
          .lean()) as any[];
        const linked = new Set<string>();
        // Chạy bù lịch sử: khoản tái tục có thể cũng đã đáo hạn → vẫn là ứng viên (chuỗi A1 → A2 → A3),
        // xét tất toán theo thứ tự thời gian để mỗi khoản nối đúng khoản sinh ra ngay sau nó
        closures.sort((a, b) => a.closure.closed_at.getTime() - b.closure.closed_at.getTime());

        closures.forEach(({ inv, closure }) => {
          const target = findRenewalTarget(
            closure,
            pool.filter((p) => String(p._id) !== String(inv._id) && !linked.has(String(p._id)))
          );
          if (target) {
            closure.renewed = true;
            linked.add(String(target._id));
            ops.push({
              updateOne: {
                filter: { _id: target._id, renewal_of: null },
                update: { $set: { renewal_of: inv._id } }
              }
            });
            result.renewalLinks += 1;
          }
          if (closure.renewed) result.renewed += 1;
          result.closed += 1;
          ops.push({
            updateOne: {
              filter: { _id: inv._id, closure: null },
              update: {
                $set: { closure, closure_attribution: attribution, holding_synced_at: now }
              }
            }
          });
        });
      }

      const stillOpen = openInvs
        .filter((inv) => !closures.some(({ inv: closed }) => closed === inv))
        .map((inv) => inv._id);
      if (stillOpen.length) {
        ops.push({
          updateMany: {
            filter: { _id: { $in: stillOpen } },
            update: { $set: { holding_synced_at: now } }
          }
        });
      }
      if (!options.dryRun && ops.length) await InvestmentModel.bulkWrite(ops, { ordered: false });
      result.synced += 1;
    } catch (err: any) {
      result.errors.push({
        external_id: String(customer.external_id),
        message: err?.response?.data?.message ?? err?.message ?? String(err)
      });
    }
  });

  return result;
}

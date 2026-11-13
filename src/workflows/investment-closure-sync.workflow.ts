import mongoose from "mongoose";
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
  isCounterCode,
  mapHoldingClosure,
  mapHoldingInvestment
} from "./investment-closure/holding-mapper";

// Đồng bộ tất toán / tái tục từ danh mục đầu tư TIKLUY (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 3, Q1–Q3).
// Chỉ ghi `closure` / `closure_attribution` / `renewal_of` phục vụ KPI (tiền ra, tăng net, AUM, tái tục) —
// KHÔNG đổi `status` và hoa hồng của khoản đầu tư (luồng hoa hồng vẫn theo /investments/upsert của TIKLUY).
// Khoản có kỳ hạn TIKLUY có mà vWork thiếu (TIKLUY không đẩy sang) → tạo bù `source: "holding_sync"`, không hoa hồng.

const PAGE_SIZE = 50;
const MAX_PAGES = 20;
// Khoản mới bắt đầu chưa đủ 3 ngày: chờ TIKLUY đẩy qua /investments/upsert (có hoa hồng), không tạo bù
const BACKFILL_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_BACKFILL_ROWS = 300;

export interface ClosureSyncOptions {
  appCode: string;
  now?: Date;
  dryRun?: boolean;
  concurrency?: number;
  limitCustomers?: number;
  /** Tạo bù khoản TIKLUY có mà vWork thiếu (mặc định bật) */
  backfillMissing?: boolean;
  /** Hỏi TIKLUY cho MỌI khách (chạy bù 1 lần) thay vì chỉ khách còn khoản chưa tất toán */
  allCustomers?: boolean;
  fetchHoldings?: (externalId: string) => Promise<HoldingRow[]>;
}

export interface BackfillRow {
  code: string | null;
  product: string;
  amount: number;
  invested_at: Date;
  maturity_at: Date;
  status: string;
  /** Sinh ra do tái tục khoản trước → không tính tiền vào */
  renewal: boolean;
  /** Mã VNFM… — mở tại quầy */
  counter: boolean;
}

export interface ClosureSyncResult {
  customers: number;
  synced: number;
  closed: number;
  renewed: number;
  renewalLinks: number;
  unknownCodes: number;
  /** Khoản tạo bù (trong đó backfillRenewals là khoản sinh ra do tái tục) */
  backfilled: number;
  backfillRenewals: number;
  /** Dòng vWork chưa có nhưng không tạo bù: không kỳ hạn (VÍ VÀNG…) / thiếu dữ liệu, hoặc mới bắt đầu < 3 ngày */
  skippedNoTerm: number;
  skippedRecent: number;
  backfillRows: BackfillRow[];
  errors: { external_id: string; message: string }[];
}

/**
 * Tạo bù các dòng danh mục mà vWork chưa có cho 1 khách. Khoản sinh ra do tái tục nối `renewal_of` vào khoản đáo hạn
 * trước nó (có sẵn hoặc vừa tạo) để không tính tiền vào; khoản đã nối thì bước tất toán không nối lại (`linkedFrom`).
 * KPI ghi cho Sale đang giữ khách (như /investments/upsert), mốc ghi nhận = ngày đầu tư.
 */
async function backfillMissingInvestments(input: {
  appId: unknown;
  customer: any;
  rows: HoldingRow[];
  now: Date;
  dryRun: boolean;
  byCode: Map<string, any>;
  linkedFrom: Set<string>;
  result: ClosureSyncResult;
}): Promise<void> {
  const { appId, customer, rows, now, byCode, linkedFrom, result } = input;
  const keys = rows.flatMap((row) => holdingKeys(row));
  if (!keys.length) return;
  const known = (await InvestmentModel.find({
    app_id: appId,
    external_investment_id: { $in: keys }
  })
    .select("_id external_investment_id")
    .lean()) as any[];
  const knownByKey = new Map(known.map((k) => [String(k.external_investment_id), k]));

  const docByRow = new Map<HoldingRow, any>();
  const docs: any[] = [];
  const attribution = await buildInvestmentAttribution(customer, null, now);
  rows.forEach((row) => {
    const existing = holdingKeys(row)
      .map((key) => knownByKey.get(key))
      .find(Boolean);
    if (existing) {
      docByRow.set(row, existing);
      return;
    }
    const data = mapHoldingInvestment(row);
    if (!data) {
      result.skippedNoTerm += 1;
      return;
    }
    if (now.getTime() - data.invested_at.getTime() < BACKFILL_MIN_AGE_MS) {
      result.skippedRecent += 1;
      return;
    }
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      app_id: appId,
      customer_id: customer._id,
      ...data,
      commission: { status: "none" },
      kpi_attribution: { ...attribution, attributed_at: data.invested_at },
      renewal_of: null as unknown,
      source: "holding_sync",
      // Đang mở lúc tạo bù → lần sau thấy tất toán trước hạn là ngày thật
      holding_synced_at: data.status === "active" ? now : null
    };
    docs.push(doc);
    docByRow.set(row, doc);
  });
  if (!docs.length) return;

  rows
    .map((row) => ({ row, closure: mapHoldingClosure(row, now) }))
    .filter(({ row, closure }) => closure?.renewed && docByRow.has(row))
    .sort((a, b) => a.closure!.closed_at.getTime() - b.closure!.closed_at.getTime())
    .forEach(({ row, closure }) => {
      const from = docByRow.get(row);
      const target = findRenewalTarget(
        closure!,
        docs.filter((doc) => !doc.renewal_of && doc !== from)
      );
      if (!target) return;
      target.renewal_of = from._id;
      linkedFrom.add(String(from._id));
    });

  let inserted = docs;
  if (!input.dryRun) {
    try {
      await InvestmentModel.insertMany(docs, { ordered: false });
    } catch (err: any) {
      // Trùng mã: TIKLUY vừa đẩy khoản đó sang trong lúc đồng bộ → bỏ dòng đó, giữ các dòng khác
      if (!err?.writeErrors) throw err;
      const failed = new Set(
        (err.writeErrors as any[]).map((e) => e.index ?? e.err?.index).filter((i) => i != null)
      );
      inserted = docs.filter((_, index) => !failed.has(index));
    }
  }
  inserted.forEach((doc) => {
    byCode.set(String(doc.external_investment_id), doc);
    result.backfilled += 1;
    if (doc.renewal_of) result.backfillRenewals += 1;
    if (result.backfillRows.length < MAX_BACKFILL_ROWS) {
      result.backfillRows.push({
        code: doc.investment_code,
        product: doc.product_name,
        amount: doc.amount,
        invested_at: doc.invested_at,
        maturity_at: doc.maturity_at,
        status: doc.status,
        renewal: Boolean(doc.renewal_of),
        counter: isCounterCode(doc.investment_code)
      });
    }
  });
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
    .select("_id customer_id external_investment_id holding_synced_at investment_code")
    .lean()) as any[];
  const openByCustomer = new Map<string, any[]>();
  open.forEach((inv) => {
    const key = String(inv.customer_id);
    if (!openByCustomer.has(key)) openByCustomer.set(key, []);
    openByCustomer.get(key)!.push(inv);
  });

  const customerFilter = options.allCustomers
    ? { app_id: app._id, external_id: { $nin: [null, ""] } }
    : { _id: { $in: [...openByCustomer.keys()] } };
  let customers = (await CustomerModel.find(customerFilter)
    .select("external_id referred_by agent_id")
    .lean()) as any[];
  if (options.limitCustomers) customers = customers.slice(0, options.limitCustomers);

  const result: ClosureSyncResult = {
    customers: customers.length,
    synced: 0,
    closed: 0,
    renewed: 0,
    renewalLinks: 0,
    unknownCodes: 0,
    backfilled: 0,
    backfillRenewals: 0,
    skippedNoTerm: 0,
    skippedRecent: 0,
    backfillRows: [],
    errors: []
  };

  await mapWithConcurrency(customers, options.concurrency ?? 3, async (customer) => {
    if (!customer.external_id) return;
    try {
      const rows = await fetchHoldings(customer.external_id);
      const openInvs = openByCustomer.get(String(customer._id)) ?? [];
      const byCode = new Map(openInvs.map((inv) => [String(inv.external_investment_id), inv]));
      const linkedFrom = new Set<string>();
      if (options.backfillMissing !== false) {
        await backfillMissingInvestments({
          appId: app._id,
          customer,
          rows,
          now,
          dryRun: Boolean(options.dryRun),
          byCode,
          linkedFrom,
          result
        });
      }

      const ops: any[] = [];
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
        if (row.investmentCode && !inv.investment_code) {
          ops.push({
            updateOne: {
              filter: { _id: inv._id, investment_code: null },
              update: { $set: { investment_code: String(row.investmentCode) } }
            }
          });
        }
        if (!closure) return;
        // Lần trước còn thấy mở → vừa tất toán, giờ phát hiện là đúng ngày; chưa từng đồng bộ → không rõ ngày
        if (closure.date_unknown && inv.holding_synced_at) closure.date_unknown = false;
        closures.push({ inv, closure });
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
          // Đã nối khoản tái tục ở bước tạo bù → không nối thêm
          const target = linkedFrom.has(String(inv._id))
            ? null
            : findRenewalTarget(
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

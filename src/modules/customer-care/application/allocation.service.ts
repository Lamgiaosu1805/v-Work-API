import mongoose from "mongoose";
import CustomerAssignmentModel from "../../../models/CustomerAssignmentModel";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import { pickSaleRoundRobin, SaleCandidate, isSaleFull } from "../domain/allocation";
import { CarePolicy } from "../domain/care-policy";
import {
  SaleAllocationProfileEntity,
  SaleAllocationStatus
} from "../domain/sale-allocation-profile.entity";
import { startOfVnDay } from "../domain/working-calendar";
import { CustomerCareStateRepository } from "../infrastructure/customer-care-state.repository";
import { SaleAllocationProfileRepository } from "../infrastructure/sale-allocation-profile.repository";
import { loadCarePolicy, loadWorkingCalendar, resolveAppId } from "../infrastructure/care-context";

const stateRepository = new CustomerCareStateRepository();
const profileRepository = new SaleAllocationProfileRepository();

const toObjectIds = (ids: string[]) => ids.map((id) => new mongoose.Types.ObjectId(id));

/** Số khách mới hôm nay + số khách đang xử lý của từng Sale (mọi kênh, mọi app). */
export async function loadSaleLoads(
  saleIds: string[],
  now: Date
): Promise<Map<string, { newToday: number; activeLoad: number }>> {
  const loads = new Map(saleIds.map((id) => [id, { newToday: 0, activeLoad: 0 }]));
  if (!saleIds.length) return loads;
  const objectIds = toObjectIds(saleIds);
  const [active, today] = await Promise.all([
    CustomerAssignmentModel.aggregate([
      { $match: { sale_id: { $in: objectIds }, status: "active", isDeleted: false } },
      { $group: { _id: "$sale_id", count: { $sum: 1 } } }
    ]),
    CustomerAssignmentModel.aggregate([
      {
        $match: {
          sale_id: { $in: objectIds },
          assigned_at: { $gte: startOfVnDay(now) },
          isDeleted: false
        }
      },
      { $group: { _id: "$sale_id", count: { $sum: 1 } } }
    ])
  ]);
  active.forEach((row) => {
    const load = loads.get(String(row._id));
    if (load) load.activeLoad = row.count;
  });
  today.forEach((row) => {
    const load = loads.get(String(row._id));
    if (load) load.newToday = row.count;
  });
  return loads;
}

export interface SaleCapacityView extends SaleCandidate {
  status: SaleAllocationStatus;
  accepting: boolean;
  isFull: boolean;
  rank: string;
  reason: string | null;
  until: Date | null;
}

/** Ứng viên kèm hạn mức theo hạng (Điều 6) và trạng thái nhận khách. */
export async function buildSaleCapacityViews(
  saleIds: string[],
  policy: CarePolicy,
  now: Date
): Promise<SaleCapacityView[]> {
  const [profiles, loads] = await Promise.all([
    profileRepository.findBySales(saleIds),
    loadSaleLoads(saleIds, now)
  ]);
  const profileBySale = new Map(profiles.map((p) => [p.saleId, p]));

  return saleIds.map((saleId) => {
    const profile = profileBySale.get(saleId);
    const props = profile?.getProps();
    const rank = props?.rank ?? policy.defaultRank;
    const rankCap = policy.capacityByRank[rank];
    const load = loads.get(saleId) ?? { newToday: 0, activeLoad: 0 };
    const candidate: SaleCandidate = {
      saleId,
      capNewPerDay: props?.capNewPerDay ?? rankCap.newPerDay,
      capTotal: props?.capTotal ?? rankCap.total,
      newToday: load.newToday,
      activeLoad: load.activeLoad,
      lastAssignedAt: props?.lastAssignedAt ?? null
    };
    return {
      ...candidate,
      status: props?.status ?? "open",
      accepting: profile ? profile.isAccepting(now) : true,
      isFull: isSaleFull(candidate),
      rank,
      reason: props?.reason ?? null,
      until: props?.until ?? null
    };
  });
}

export interface PlannedAllocation {
  customerId: string;
  saleId: string;
}

export interface PoolAllocationPlan {
  skippedReason: "app_not_configured" | "disabled" | "outside_working_hours" | null;
  allocations: PlannedAllocation[];
  /** Số khách còn tồn trong Pool sau lượt phân này */
  leftInPool: number;
}

/**
 * Lập kế hoạch phân khách trong Pool cho các Sale đủ điều kiện (caller đã lọc theo role, nghỉ phép,
 * nghỉ việc). Chỉ ĐỌC — caller thực thi từng phân bổ trong transaction riêng (assignCustomerToSale).
 */
export async function planPoolAllocation(input: {
  appCode: string;
  now: Date;
  eligibleSaleIds: string[];
  maxCustomers?: number;
}): Promise<PoolAllocationPlan> {
  const policy = await loadCarePolicy(input.appCode);
  if (!policy) return { skippedReason: "app_not_configured", allocations: [], leftInPool: 0 };
  if (!policy.enabled) return { skippedReason: "disabled", allocations: [], leftInPool: 0 };
  const calendar = await loadWorkingCalendar(policy, input.now);
  if (!calendar.isWorkingTime(input.now)) {
    return { skippedReason: "outside_working_hours", allocations: [], leftInPool: 0 };
  }
  const appId = await resolveAppId(input.appCode);
  if (!appId) return { skippedReason: "app_not_configured", allocations: [], leftInPool: 0 };

  const views = await buildSaleCapacityViews(input.eligibleSaleIds, policy, input.now);
  const candidates = views.filter((v) => v.accepting);
  const queue = await stateRepository.findPoolQueue(appId, input.maxCustomers ?? 200);

  const allocations: PlannedAllocation[] = [];
  queue.forEach((state, index) => {
    const picked = pickSaleRoundRobin(candidates, state.previousSaleIds);
    if (!picked) return;
    allocations.push({ customerId: state.customerId, saleId: picked.saleId });
    picked.newToday += 1;
    picked.activeLoad += 1;
    // giữ thứ tự round-robin trong cùng 1 lượt phân
    picked.lastAssignedAt = new Date(input.now.getTime() + index);
  });

  return { skippedReason: null, allocations, leftInPool: queue.length - allocations.length };
}

// ─── Trạng thái nhận khách của Sale ────────────────────────────────────────────────────

export async function setSaleAllocationStatus(input: {
  saleId: string;
  status: SaleAllocationStatus;
  reason: string | null;
  until: Date | null;
  by: string;
  at: Date;
  defaultRank: CarePolicy["defaultRank"];
}): Promise<SaleAllocationProfileEntity> {
  const profile =
    (await profileRepository.findBySale(input.saleId)) ??
    SaleAllocationProfileEntity.createDefault(
      new mongoose.Types.ObjectId().toString(),
      input.saleId,
      input.defaultRank
    );
  if (input.status === "paused") profile.pause(input.reason ?? "", input.until, input.by, input.at);
  else if (input.status === "locked") profile.lock(input.reason ?? "", input.by, input.at);
  else if (input.status === "open") profile.open(input.by, input.at);
  else throw new ArgumentInvalidException("Trạng thái nhận khách không hợp lệ");
  await profileRepository.upsert(profile);
  return profile;
}

export async function setSaleCaps(input: {
  saleId: string;
  capNewPerDay: number | null;
  capTotal: number | null;
  defaultRank: CarePolicy["defaultRank"];
}): Promise<SaleAllocationProfileEntity> {
  const profile =
    (await profileRepository.findBySale(input.saleId)) ??
    SaleAllocationProfileEntity.createDefault(
      new mongoose.Types.ObjectId().toString(),
      input.saleId,
      input.defaultRank
    );
  profile.setCaps(input.capNewPerDay, input.capTotal);
  await profileRepository.upsert(profile);
  return profile;
}

/** Sale bị KHOÁ nhận khách (khác tạm dừng có thời hạn — tạm dừng không thu hồi khách đang giữ). */
export async function isSaleLocked(saleId: string): Promise<boolean> {
  const profile = await profileRepository.findBySale(saleId);
  return profile?.getProps().status === "locked";
}

export async function requireCarePolicy(appCode: string): Promise<CarePolicy> {
  const policy = await loadCarePolicy(appCode);
  if (!policy) throw new NotFoundException("Ứng dụng chưa được cấu hình quy trình chăm sóc khách");
  return policy;
}

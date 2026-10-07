// Use-case GHI của module customer-care. Các hàm ghi nhiều collection PHẢI được gọi bên trong
// runInTransaction của caller (workflow) — repository tự nhặt session qua RequestContextService.
import mongoose from "mongoose";
import { ConflictException, NotFoundException } from "../../../core/exceptions/exceptions";
import { classifyCustomer, CarePolicy } from "../domain/care-policy";
import {
  AssignmentChannel,
  AssignmentEndReason,
  CustomerAssignmentEntity,
  SlaAction
} from "../domain/customer-assignment.entity";
import { CustomerCareStateEntity, PoolStatus } from "../domain/customer-care-state.entity";
import { SaleAllocationProfileEntity } from "../domain/sale-allocation-profile.entity";
import { CustomerAssignmentRepository } from "../infrastructure/customer-assignment.repository";
import { CustomerCareStateRepository } from "../infrastructure/customer-care-state.repository";
import { SaleAllocationProfileRepository } from "../infrastructure/sale-allocation-profile.repository";
import {
  loadCarePolicy,
  loadCarePolicyByAppId,
  loadWorkingCalendar
} from "../infrastructure/care-context";

const assignmentRepository = new CustomerAssignmentRepository();
const stateRepository = new CustomerCareStateRepository();
const profileRepository = new SaleAllocationProfileRepository();

const newId = () => new mongoose.Types.ObjectId().toString();

async function requirePolicyByAppId(appId: string): Promise<CarePolicy> {
  const policy = await loadCarePolicyByAppId(appId);
  if (!policy) {
    throw new ConflictException("Ứng dụng của khách chưa được bật quy trình chăm sóc khách");
  }
  return policy;
}

async function touchSaleProfile(saleId: string, policy: CarePolicy, at: Date): Promise<void> {
  const profile =
    (await profileRepository.findBySale(saleId)) ??
    SaleAllocationProfileEntity.createDefault(newId(), saleId, policy.defaultRank);
  profile.touchAssigned(at);
  await profileRepository.upsert(profile);
}

// ─── Đồng bộ khách vào phạm vi chăm sóc ────────────────────────────────────────────────

export interface SyncCustomerCareInput {
  customerId: string;
  appId: string;
  appCode: string;
  kycVerified: boolean;
  hasInvestment: boolean;
  /** Sale phụ trách hiện tại trên Customer (referred_by), null nếu khách marketing chưa có Sale */
  currentSaleId: string | null;
  at: Date;
  /**
   * Kênh của lượt giao nếu phát hiện Customer đổi Sale ngoài luồng customer-care (màn cũ: gán/chuyển
   * Sale, duyệt yêu cầu nhận khách, khách nhập mã giới thiệu). Mặc định `referral`.
   */
  ownerChannel?: AssignmentChannel;
  actorAccountId?: string | null;
}

export type SyncCustomerCareResult =
  | { action: "skipped" }
  | { action: "created"; poolStatus: PoolStatus; assignmentId: string | null }
  | { action: "updated"; poolStatus: PoolStatus; assignmentId: string | null }
  | { action: "converted"; endedSaleId: string | null };

/**
 * Idempotent — gọi sau mỗi lần khách đăng ký / eKYC / nhập mã giới thiệu / đầu tư.
 * - Khách mới không có Sale → vào Pool. Có Sale (mã giới thiệu) → lượt giao kênh `referral`.
 * - eKYC → đổi nhóm B → A (cả trạng thái lẫn lượt giao đang chạy).
 * - Có khoản đầu tư → chuyển đổi: kết thúc lượt giao, khách vẫn thuộc Sale (hoa hồng theo người giữ).
 */
export async function syncCustomerCare(
  input: SyncCustomerCareInput
): Promise<SyncCustomerCareResult> {
  const policy = await loadCarePolicy(input.appCode);
  if (!policy) return { action: "skipped" };

  const cls = classifyCustomer(input);
  let state = await stateRepository.findByCustomer(input.customerId);
  const isNew = !state;

  if (!state) {
    state = CustomerCareStateEntity.create({
      id: newId(),
      customerId: input.customerId,
      appId: input.appId,
      priorityClass: cls ?? "B",
      at: input.at
    });
    if (cls === null) {
      state.markConverted(input.at);
      await stateRepository.insert(state);
      return { action: "converted", endedSaleId: null };
    }
    await stateRepository.insert(state);
  }

  const active = await assignmentRepository.findActiveByCustomer(input.customerId);

  if (cls === null) {
    if (state.poolStatus === "converted")
      return { action: "updated", poolStatus: "converted", assignmentId: null };
    let endedSaleId: string | null = null;
    if (active) {
      active.end("converted", input.at, null, "Khách đã đầu tư");
      await assignmentRepository.updateById(active.id, active);
      endedSaleId = active.saleId;
    }
    state.markConverted(input.at);
    await stateRepository.updateById(state.id, state);
    return { action: "converted", endedSaleId };
  }

  let assignmentId = active?.id ?? null;
  let activeAssignment = active;
  if (cls !== state.priorityClass && state.poolStatus !== "nurturing") {
    state.reclassify(cls);
    if (activeAssignment) {
      const calendar = await loadWorkingCalendar(policy, input.at);
      activeAssignment.reclassify(cls, input.at, policy, calendar);
      await assignmentRepository.updateById(activeAssignment.id, activeAssignment);
    }
  }

  // Đối soát: Customer đổi Sale ngoài luồng customer-care (màn cũ) → kết thúc lượt giao lệch
  if (activeAssignment && activeAssignment.saleId !== input.currentSaleId) {
    const actor = input.actorAccountId ?? null;
    if (!input.currentSaleId) {
      activeAssignment.end(
        "revoked_manual",
        input.at,
        actor,
        "Gỡ Sale phụ trách từ màn khách hàng"
      );
      state.release(input.at, policy.maxSaleRounds, "revoked_manual");
    } else {
      const reason = input.ownerChannel === "claim" ? "claimed" : "reassigned";
      activeAssignment.end(reason, input.at, actor, "Đổi Sale phụ trách từ màn khách hàng");
      state.release(input.at, Number.POSITIVE_INFINITY, reason);
    }
    await assignmentRepository.updateById(activeAssignment.id, activeAssignment);
    activeAssignment = null;
    assignmentId = null;
  }

  // Customer đã có Sale nhưng chưa có lượt giao (đăng ký có mã / nhập mã sau / gán từ màn cũ) → tạo lượt giao
  if (
    input.currentSaleId &&
    !activeAssignment &&
    ["in_pool", "nurturing", "excluded"].includes(state.poolStatus)
  ) {
    const calendar = await loadWorkingCalendar(policy, input.at);
    assignmentId = newId();
    const round = state.assign(assignmentId, input.currentSaleId);
    const assignment = CustomerAssignmentEntity.assign(
      {
        id: assignmentId,
        customerId: input.customerId,
        appId: input.appId,
        saleId: input.currentSaleId,
        round,
        channel: input.ownerChannel ?? "referral",
        priorityClass: cls,
        assignedAt: input.at,
        assignedBy: input.actorAccountId ?? null
      },
      policy,
      calendar
    );
    await assignmentRepository.insert(assignment);
  }

  await stateRepository.updateById(state.id, state);
  return {
    action: isNew ? "created" : "updated",
    poolStatus: state.poolStatus,
    assignmentId
  };
}

// ─── Giao / kết thúc lượt giao ──────────────────────────────────────────────────────────

export interface AssignCustomerToSaleInput {
  customerId: string;
  saleId: string;
  channel: Exclude<AssignmentChannel, "referral">;
  assignedBy: string | null;
  at: Date;
}

export interface AssignCustomerToSaleResult {
  assignmentId: string;
  appId: string;
  round: number;
  priorityClass: "A" | "B";
  firstContactDueAt: Date;
}

export async function assignCustomerToSale(
  input: AssignCustomerToSaleInput
): Promise<AssignCustomerToSaleResult> {
  const state = await stateRepository.findByCustomer(input.customerId);
  if (!state) throw new NotFoundException("Khách chưa thuộc phạm vi chăm sóc (chưa vào Pool)");
  if (state.currentSaleId === input.saleId) {
    throw new ConflictException("Khách đang do chính Sale này phụ trách");
  }
  const { appId } = state.getProps();
  const policy = await requirePolicyByAppId(appId);
  const calendar = await loadWorkingCalendar(policy, input.at);
  const priorityClass = state.priorityClass === "C" ? "B" : state.priorityClass;

  const assignmentId = newId();
  const round = state.assign(assignmentId, input.saleId);
  const assignment = CustomerAssignmentEntity.assign(
    {
      id: assignmentId,
      customerId: input.customerId,
      appId,
      saleId: input.saleId,
      round,
      channel: input.channel,
      priorityClass,
      assignedAt: input.at,
      assignedBy: input.assignedBy
    },
    policy,
    calendar
  );
  await assignmentRepository.insert(assignment);
  await stateRepository.updateById(state.id, state);
  await touchSaleProfile(input.saleId, policy, input.at);

  return {
    assignmentId,
    appId,
    round,
    priorityClass,
    firstContactDueAt: assignment.getProps().firstContactDueAt
  };
}

export interface EndAssignmentInput {
  customerId: string;
  reason: Exclude<AssignmentEndReason, "converted">;
  at: Date;
  endedBy: string | null;
  note: string | null;
}

export interface EndAssignmentResult {
  assignmentId: string;
  saleId: string;
  poolStatus: PoolStatus;
}

/**
 * Kết thúc lượt giao đang chạy. Thu hồi (revoked_*, sale_offboarded) → khách về Pool hoặc chuyển CSKH
 * nếu đã đủ số vòng. Chuyển thẳng Sale (reassigned/claimed) → không tính là hết vòng, caller giao
 * tiếp ngay trong cùng transaction.
 */
export async function endActiveAssignment(input: EndAssignmentInput): Promise<EndAssignmentResult> {
  const active = await assignmentRepository.findActiveByCustomer(input.customerId);
  if (!active) throw new ConflictException("Khách không có lượt giao đang hiệu lực");
  const state = await stateRepository.findByCustomer(input.customerId);
  if (!state) throw new NotFoundException("Không tìm thấy trạng thái chăm sóc của khách");
  const policy = await requirePolicyByAppId(state.getProps().appId);

  active.end(input.reason, input.at, input.endedBy, input.note);
  await assignmentRepository.updateById(active.id, active);

  const isTransfer = input.reason === "reassigned" || input.reason === "claimed";
  const poolStatus = state.release(
    input.at,
    isTransfer ? Number.POSITIVE_INFINITY : policy.maxSaleRounds,
    input.reason
  );
  await stateRepository.updateById(state.id, state);

  return { assignmentId: active.id, saleId: active.saleId, poolStatus };
}

/** CSKH/quản lý đưa khách nuôi dưỡng (hoặc đang bị loại) về Pool khi khách có nhu cầu mới. */
export async function returnCustomerToPool(input: {
  customerId: string;
  kycVerified: boolean;
  at: Date;
  reason: string | null;
}): Promise<void> {
  const state = await stateRepository.findByCustomer(input.customerId);
  if (!state) throw new NotFoundException("Khách chưa thuộc phạm vi chăm sóc");
  state.returnToPool(input.at, input.kycVerified ? "A" : "B", input.reason);
  await stateRepository.updateById(state.id, state);
}

/** Loại khách khỏi Pool (vd không thuộc đối tượng phân cho Sale), bắt buộc lý do. */
export async function excludeCustomerFromPool(customerId: string, reason: string): Promise<void> {
  const state = await stateRepository.findByCustomer(customerId);
  if (!state) throw new NotFoundException("Khách chưa thuộc phạm vi chăm sóc");
  state.exclude(reason);
  await stateRepository.updateById(state.id, state);
}

// ─── Ghi nhận hoạt động chăm sóc ────────────────────────────────────────────────────────

export interface RecordActivityResult {
  counted: boolean;
  valid: boolean;
  assignmentId: string | null;
}

/** Cuộc gọi tổng đài của Sale tới khách — chỉ tính cho lượt giao của đúng Sale đó. */
export async function recordCallActivity(input: {
  customerId: string;
  saleId: string;
  at: Date;
  answerSec: number;
}): Promise<RecordActivityResult> {
  const active = await assignmentRepository.findActiveByCustomer(input.customerId);
  if (!active || active.saleId !== input.saleId) {
    return { counted: false, valid: false, assignmentId: null };
  }
  const policy = await requirePolicyByAppId(active.getProps().appId);
  const calendar = await loadWorkingCalendar(policy, input.at);
  const valid = active.recordContactAttempt(
    { at: input.at, answerSec: input.answerSec },
    policy,
    calendar
  );
  await assignmentRepository.updateById(active.id, active);
  return { counted: true, valid, assignmentId: active.id };
}

/** Báo cáo chăm sóc đủ 4 trường của Sale đang được giao khách. */
export async function recordCareReport(input: {
  customerId: string;
  saleId: string;
  at: Date;
  appointmentAt: Date | null;
}): Promise<RecordActivityResult> {
  const active = await assignmentRepository.findActiveByCustomer(input.customerId);
  if (!active || active.saleId !== input.saleId) {
    return { counted: false, valid: false, assignmentId: null };
  }
  const policy = await requirePolicyByAppId(active.getProps().appId);
  const calendar = await loadWorkingCalendar(policy, input.at);
  active.recordCareReport({ at: input.at, appointmentAt: input.appointmentAt }, policy, calendar);
  await assignmentRepository.updateById(active.id, active);
  return { counted: true, valid: true, assignmentId: active.id };
}

// ─── Quét SLA ────────────────────────────────────────────────────────────────────────────

export interface DueSlaAction {
  assignmentId: string;
  customerId: string;
  saleId: string;
  appId: string;
  priorityClass: "A" | "B";
  channel: AssignmentChannel;
  action: SlaAction;
}

/** Lượt giao tới mốc cảnh báo/thu hồi. Bỏ qua app đang ở chế độ chạy thử (enabled = false). */
export async function listDueSlaActions(now: Date, limit = 200): Promise<DueSlaAction[]> {
  const due = await assignmentRepository.findDueForSweep(now, limit);
  const policyCache = new Map<string, CarePolicy | null>();
  const result: DueSlaAction[] = [];

  for (const assignment of due) {
    const { appId } = assignment.getProps();
    if (!policyCache.has(appId)) policyCache.set(appId, await loadCarePolicyByAppId(appId));
    if (!policyCache.get(appId)?.enabled) continue;

    const action = assignment.evaluate(now);
    if (!action) continue;
    result.push({
      assignmentId: assignment.id,
      customerId: assignment.customerId,
      saleId: assignment.saleId,
      appId,
      priorityClass: assignment.priorityClass,
      channel: assignment.channel,
      action
    });
  }
  return result;
}

export async function markAssignmentWarned(
  assignmentId: string,
  kind: "no_contact" | "inactive",
  at: Date
): Promise<void> {
  const assignment = await assignmentRepository.findOneById(assignmentId);
  if (!assignment || !assignment.isActive) return;
  assignment.markWarned(kind, at);
  await assignmentRepository.updateById(assignment.id, assignment);
}

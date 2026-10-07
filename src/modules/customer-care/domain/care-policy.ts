// Chính sách chăm sóc khách theo Quy định 183A (bản áp cho khách đã đăng ký app — xem
// docs/CRM-CUSTOMER-CARE-SLA-PLAN.md). Mọi mốc thời gian tính bằng PHÚT LÀM VIỆC.

export type PriorityClass = "A" | "B" | "C";
export type SaleRank = "A" | "B" | "C" | "D";

export interface ClassSla {
  /** Hạn liên hệ lần đầu (Điều 7: A ≤ 5', B ≤ 15') */
  firstContactMinutes: number;
  /** Mốc cảnh báo Sale + trưởng nhóm nếu chưa liên hệ */
  warnMinutes: number;
  /** Mốc tự thu hồi nếu chưa liên hệ */
  revokeMinutes: number;
  /** Không có hoạt động hợp lệ quá số phút này → thu hồi (Điều 8.2c: A 24h, B 48h) */
  inactivityMinutes: number;
  /** Tần suất tối thiểu nếu chưa kết nối được (Điều 7: 3 lần) */
  minAttemptsIfNotConnected: number;
}

export interface RankCapacity {
  /** Lead/khách mới tối đa mỗi ngày (Điều 6) */
  newPerDay: number;
  /** Tổng khách đang phải xử lý tối đa */
  total: number;
}

export interface CarePolicy {
  appCode: string;
  /** false = chỉ ghi nhận khách vào Pool, KHÔNG tự phân và KHÔNG thu hồi (chế độ chạy thử) */
  enabled: boolean;
  sla: Record<"A" | "B", ClassSla>;
  /** Cuộc gọi nghe máy tối thiểu bao nhiêu giây mới là hoạt động hợp lệ (chống gọi nháy máy) */
  validCallMinAnswerSec: number;
  /** Sau bao nhiêu vòng Sale chưa chuyển đổi thì chuyển CSKH nuôi dưỡng (Điều 8.3) */
  maxSaleRounds: number;
  /** Lịch hẹn còn hiệu lực bao lâu sau giờ hẹn (phút làm việc) trước khi lại tính không hoạt động */
  appointmentGraceMinutes: number;
  /** Hạn mức theo hạng Sale (Điều 6). Giai đoạn 1 mọi Sale mặc định hạng C */
  capacityByRank: Record<SaleRank, RankCapacity>;
  defaultRank: SaleRank;
  /** Khách có mã Sale (kênh referral): có tự thu hồi khi vi phạm SLA không. Mặc định chỉ cảnh báo */
  autoRevokeReferral: boolean;
  workStartMinute: number;
  workEndMinute: number;
}

const WORKING_DAY_MINUTES = 9 * 60; // 8:00–17:00

export const DEFAULT_CARE_POLICY: Omit<CarePolicy, "appCode"> = {
  enabled: false,
  sla: {
    A: {
      firstContactMinutes: 5,
      warnMinutes: 15,
      revokeMinutes: 30,
      inactivityMinutes: WORKING_DAY_MINUTES, // 24h ≈ 1 ngày làm việc
      minAttemptsIfNotConnected: 3
    },
    B: {
      firstContactMinutes: 15,
      warnMinutes: 15,
      revokeMinutes: 60,
      inactivityMinutes: 2 * WORKING_DAY_MINUTES, // 48h ≈ 2 ngày làm việc
      minAttemptsIfNotConnected: 3
    }
  },
  validCallMinAnswerSec: 20,
  maxSaleRounds: 2,
  appointmentGraceMinutes: 120,
  capacityByRank: {
    A: { newPerDay: 20, total: 70 },
    B: { newPerDay: 15, total: 60 },
    C: { newPerDay: 10, total: 50 },
    D: { newPerDay: 5, total: 35 }
  },
  defaultRank: "C",
  autoRevokeReferral: false,
  workStartMinute: 8 * 60,
  workEndMinute: 17 * 60
};

export function buildCarePolicy(appCode: string, overrides: Partial<CarePolicy> = {}): CarePolicy {
  return {
    ...DEFAULT_CARE_POLICY,
    ...overrides,
    appCode,
    sla: {
      A: { ...DEFAULT_CARE_POLICY.sla.A, ...(overrides.sla?.A ?? {}) },
      B: { ...DEFAULT_CARE_POLICY.sla.B, ...(overrides.sla?.B ?? {}) }
    },
    capacityByRank: { ...DEFAULT_CARE_POLICY.capacityByRank, ...(overrides.capacityByRank ?? {}) }
  };
}

export interface CustomerLifecycleSnapshot {
  kycVerified: boolean;
  hasInvestment: boolean;
}

/**
 * Nhóm ưu tiên theo trạng thái (đã chốt): đã eKYC chưa đầu tư = A, chưa eKYC = B.
 * Khách đã đầu tư trả về null = đã chuyển đổi, không còn thuộc phạm vi SLA Sale.
 */
export function classifyCustomer(snapshot: CustomerLifecycleSnapshot): "A" | "B" | null {
  if (snapshot.hasInvestment) return null;
  return snapshot.kycVerified ? "A" : "B";
}

export function validateCarePolicy(policy: CarePolicy): string[] {
  const errors: string[] = [];
  (["A", "B"] as const).forEach((cls) => {
    const sla = policy.sla[cls];
    const label = `Nhóm ${cls}`;
    if (!(sla.firstContactMinutes > 0)) errors.push(`${label}: hạn liên hệ lần đầu phải > 0`);
    if (sla.warnMinutes < sla.firstContactMinutes)
      errors.push(`${label}: mốc cảnh báo không được sớm hơn hạn liên hệ`);
    if (sla.revokeMinutes < sla.warnMinutes)
      errors.push(`${label}: mốc thu hồi không được sớm hơn mốc cảnh báo`);
    if (!(sla.inactivityMinutes > 0)) errors.push(`${label}: thời gian không hoạt động phải > 0`);
    if (!(sla.minAttemptsIfNotConnected >= 1))
      errors.push(`${label}: số lần gọi tối thiểu phải >= 1`);
  });
  if (!(policy.validCallMinAnswerSec >= 0)) errors.push("Ngưỡng giây cuộc gọi hợp lệ phải >= 0");
  if (!(policy.maxSaleRounds >= 1)) errors.push("Số vòng Sale tối đa phải >= 1");
  (Object.keys(policy.capacityByRank) as SaleRank[]).forEach((rank) => {
    const cap = policy.capacityByRank[rank];
    if (!(cap.newPerDay >= 0) || !(cap.total >= cap.newPerDay))
      errors.push(`Hạn mức hạng ${rank}: tổng phải >= số khách mới/ngày`);
  });
  if (policy.workEndMinute <= policy.workStartMinute)
    errors.push("Giờ kết thúc ca phải sau giờ bắt đầu");
  return errors;
}

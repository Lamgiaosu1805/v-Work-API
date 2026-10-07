import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException, ConflictException } from "../../../core/exceptions/exceptions";
import { CarePolicy } from "./care-policy";
import { WorkingCalendar } from "./working-calendar";

// Một LƯỢT GIAO khách cho 1 Sale (Quy định 183A, Điều 7–8). Mỗi lần giao/phân lại tạo 1 lượt mới,
// lượt cũ kết thúc kèm lý do — nhờ vậy giữ được lịch sử thu hồi/phân lại và mốc SLA của từng Sale.

export type AssignmentChannel = "auto" | "manual" | "referral" | "claim";
export type AssignmentStatus = "active" | "ended";
export type AssignmentEndReason =
  | "revoked_no_contact" // không liên hệ lần đầu đúng SLA (Điều 8.2a)
  | "revoked_inactive" // không có hoạt động hợp lệ trong 24h/48h (Điều 8.2c)
  | "revoked_manual" // quản lý thu hồi (giữ khách, khai sai, gian lận... — Điều 8.2b/e)
  | "sale_offboarded" // Sale nghỉ việc / bị khoá nhận khách (Điều 8.2d)
  | "reassigned" // quản lý chuyển thẳng sang Sale khác
  | "claimed" // yêu cầu nhận khách của Sale giới thiệu được duyệt
  | "converted"; // khách đã đầu tư — kết thúc SLA chăm sóc khách mới

export const REVOKE_REASONS: AssignmentEndReason[] = [
  "revoked_no_contact",
  "revoked_inactive",
  "revoked_manual",
  "sale_offboarded"
];

export const isOwnReferral = (channel: AssignmentChannel): boolean =>
  channel === "referral" || channel === "claim";

export type SlaAction =
  | "warn_no_contact"
  | "revoke_no_contact"
  | "warn_inactive"
  | "revoke_inactive";

export interface CustomerAssignmentProps {
  customerId: string;
  appId: string;
  saleId: string;
  round: number;
  channel: AssignmentChannel;
  priorityClass: "A" | "B";
  assignedAt: Date;
  assignedBy: string | null;
  autoRevoke: boolean;
  firstContactDueAt: Date;
  warnAt: Date;
  revokeAt: Date;
  inactivityDueAt: Date;
  firstContactAt: Date | null;
  firstContactBreached: boolean;
  lastValidActivityAt: Date | null;
  attemptCount: number;
  attemptsSinceValid: number;
  warnedAt: Date | null;
  inactivityWarnedAt: Date | null;
  appointmentAt: Date | null;
  status: AssignmentStatus;
  endedAt: Date | null;
  endedReason: AssignmentEndReason | null;
  endedBy: string | null;
  endNote: string | null;
}

export interface AssignCustomerInput {
  id: string;
  customerId: string;
  appId: string;
  saleId: string;
  round: number;
  channel: AssignmentChannel;
  priorityClass: "A" | "B";
  assignedAt: Date;
  assignedBy: string | null;
}

export interface ContactAttemptInput {
  at: Date;
  answerSec: number;
}

export class CustomerAssignmentEntity extends AggregateRoot<CustomerAssignmentProps> {
  static assign(
    input: AssignCustomerInput,
    policy: CarePolicy,
    calendar: WorkingCalendar
  ): CustomerAssignmentEntity {
    const sla = policy.sla[input.priorityClass];
    const start = input.assignedAt;
    return new CustomerAssignmentEntity({
      id: input.id,
      props: {
        customerId: input.customerId,
        appId: input.appId,
        saleId: input.saleId,
        round: input.round,
        channel: input.channel,
        priorityClass: input.priorityClass,
        assignedAt: start,
        assignedBy: input.assignedBy,
        // Khách Sale tự giới thiệu (có mã / yêu cầu nhận khách được duyệt): mặc định chỉ cảnh báo
        autoRevoke: isOwnReferral(input.channel) ? policy.autoRevokeReferral : true,
        firstContactDueAt: calendar.addWorkingMinutes(start, sla.firstContactMinutes),
        warnAt: calendar.addWorkingMinutes(start, sla.warnMinutes),
        revokeAt: calendar.addWorkingMinutes(start, sla.revokeMinutes),
        inactivityDueAt: calendar.addWorkingMinutes(start, sla.inactivityMinutes),
        firstContactAt: null,
        firstContactBreached: false,
        lastValidActivityAt: null,
        attemptCount: 0,
        attemptsSinceValid: 0,
        warnedAt: null,
        inactivityWarnedAt: null,
        appointmentAt: null,
        status: "active",
        endedAt: null,
        endedReason: null,
        endedBy: null,
        endNote: null
      }
    });
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get saleId(): string {
    return this.props.saleId;
  }

  get channel(): AssignmentChannel {
    return this.props.channel;
  }

  get priorityClass(): "A" | "B" {
    return this.props.priorityClass;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }

  get firstContactAt(): Date | null {
    return this.props.firstContactAt;
  }

  get endedReason(): AssignmentEndReason | null {
    return this.props.endedReason;
  }

  private ensureActive(): void {
    if (!this.isActive) {
      throw new ConflictException("Lượt giao khách đã kết thúc");
    }
  }

  /**
   * Ghi nhận 1 lần gọi của Sale tới khách (log tổng đài). Lần gọi đầu tiên sau khi giao = liên hệ
   * lần đầu, kể cả không nghe máy. Cuộc gọi nghe máy ≥ ngưỡng = hoạt động hợp lệ; nếu chưa kết nối
   * được nhưng đã gọi đủ số lần tối thiểu (Điều 7: 3 lần) thì cũng tính là đã chăm sóc hợp lệ.
   * Trả về true nếu lần gọi này được tính là hoạt động hợp lệ.
   */
  recordContactAttempt(
    { at, answerSec }: ContactAttemptInput,
    policy: CarePolicy,
    calendar: WorkingCalendar
  ): boolean {
    this.ensureActive();
    if (at.getTime() < this.props.assignedAt.getTime()) return false;

    const patch: Partial<CustomerAssignmentProps> = {
      attemptCount: this.props.attemptCount + 1
    };
    if (!this.props.firstContactAt) {
      patch.firstContactAt = at;
      patch.firstContactBreached = at.getTime() > this.props.firstContactDueAt.getTime();
    }
    this._setProps(patch);

    const sla = policy.sla[this.props.priorityClass];
    if (answerSec >= policy.validCallMinAnswerSec) {
      this.markValidActivity(at, policy, calendar);
      return true;
    }
    const attemptsSinceValid = this.props.attemptsSinceValid + 1;
    if (attemptsSinceValid >= sla.minAttemptsIfNotConnected) {
      this.markValidActivity(at, policy, calendar);
      return true;
    }
    this._setProps({ attemptsSinceValid });
    return false;
  }

  /**
   * Báo cáo chăm sóc đủ 4 trường bắt buộc (Điều 7.2) = hoạt động hợp lệ. Có lịch hẹn thì gia hạn
   * mốc "không hoạt động" tới sau giờ hẹn (Điều 8.2c: trừ trường hợp đã có lịch hẹn cụ thể).
   */
  recordCareReport(
    { at, appointmentAt }: { at: Date; appointmentAt: Date | null },
    policy: CarePolicy,
    calendar: WorkingCalendar
  ): void {
    this.ensureActive();
    if (!this.props.firstContactAt) {
      this._setProps({
        firstContactAt: at,
        firstContactBreached: at.getTime() > this.props.firstContactDueAt.getTime()
      });
    }
    this.markValidActivity(at, policy, calendar);
    if (appointmentAt) {
      const appointmentDue = calendar.addWorkingMinutes(
        appointmentAt,
        policy.appointmentGraceMinutes
      );
      this._setProps({
        appointmentAt,
        inactivityDueAt:
          appointmentDue.getTime() > this.props.inactivityDueAt.getTime()
            ? appointmentDue
            : this.props.inactivityDueAt
      });
    }
  }

  private markValidActivity(at: Date, policy: CarePolicy, calendar: WorkingCalendar): void {
    const sla = policy.sla[this.props.priorityClass];
    const nextDue = calendar.addWorkingMinutes(at, sla.inactivityMinutes);
    this._setProps({
      lastValidActivityAt: at,
      attemptsSinceValid: 0,
      inactivityWarnedAt: null,
      inactivityDueAt:
        nextDue.getTime() > this.props.inactivityDueAt.getTime()
          ? nextDue
          : this.props.inactivityDueAt
    });
  }

  /**
   * Khách đổi nhóm khi đang được giao (vd eKYC xong: B → A). Các mốc chưa đạt được tính lại theo
   * nhóm mới từ thời điểm đổi, lấy mốc SỚM hơn — không phạt hồi tố cho khoảng thời gian trước đó.
   */
  reclassify(
    priorityClass: "A" | "B",
    at: Date,
    policy: CarePolicy,
    calendar: WorkingCalendar
  ): void {
    if (!this.isActive || priorityClass === this.props.priorityClass) return;
    const sla = policy.sla[priorityClass];
    const earlier = (current: Date, minutes: number) => {
      const candidate = calendar.addWorkingMinutes(at, minutes);
      return candidate.getTime() < current.getTime() ? candidate : current;
    };
    const patch: Partial<CustomerAssignmentProps> = { priorityClass };
    if (!this.props.firstContactAt) {
      patch.firstContactDueAt = earlier(this.props.firstContactDueAt, sla.firstContactMinutes);
      patch.warnAt = earlier(this.props.warnAt, sla.warnMinutes);
      patch.revokeAt = earlier(this.props.revokeAt, sla.revokeMinutes);
    }
    if (!this.props.lastValidActivityAt && !this.props.appointmentAt) {
      patch.inactivityDueAt = earlier(this.props.inactivityDueAt, sla.inactivityMinutes);
    }
    this._setProps(patch);
  }

  /** Việc cần làm với lượt giao tại thời điểm `now` (cảnh báo / thu hồi), null nếu không có. */
  evaluate(now: Date): SlaAction | null {
    if (!this.isActive) return null;
    const t = now.getTime();

    if (!this.props.firstContactAt) {
      if (this.props.autoRevoke && t >= this.props.revokeAt.getTime()) return "revoke_no_contact";
      if (!this.props.warnedAt && t >= this.props.warnAt.getTime()) return "warn_no_contact";
      return null;
    }

    if (t >= this.props.inactivityDueAt.getTime()) {
      if (this.props.autoRevoke) return "revoke_inactive";
      if (!this.props.inactivityWarnedAt) return "warn_inactive";
    }
    return null;
  }

  markWarned(kind: "no_contact" | "inactive", at: Date): void {
    this.ensureActive();
    this._setProps(kind === "no_contact" ? { warnedAt: at } : { inactivityWarnedAt: at });
  }

  end(reason: AssignmentEndReason, at: Date, endedBy: string | null, note: string | null): void {
    this.ensureActive();
    this._setProps({
      status: "ended",
      endedAt: at,
      endedReason: reason,
      endedBy,
      endNote: note
    });
  }

  validate(): void {
    const p = this.props;
    if (!p.customerId || !p.appId || !p.saleId) {
      throw new ArgumentInvalidException("Lượt giao thiếu customerId/appId/saleId");
    }
    if (!(p.round >= 1)) throw new ArgumentInvalidException("Lượt giao phải có round >= 1");
    if (!["auto", "manual", "referral", "claim"].includes(p.channel)) {
      throw new ArgumentInvalidException("Kênh giao khách không hợp lệ");
    }
    if (!["A", "B"].includes(p.priorityClass)) {
      throw new ArgumentInvalidException("Nhóm ưu tiên của lượt giao phải là A hoặc B");
    }
    if (p.status === "ended" && !p.endedReason) {
      throw new ArgumentInvalidException("Lượt giao đã kết thúc phải có lý do");
    }
  }
}

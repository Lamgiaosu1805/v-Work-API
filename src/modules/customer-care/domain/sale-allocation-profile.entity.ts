import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { SaleRank } from "./care-policy";

// Trạng thái nhận khách của 1 Sale (Điều 6.3, 8.2d, 11): quản lý được tạm dừng (có thời hạn) hoặc
// khoá nhận khách, luôn kèm lý do + người thao tác.

export type SaleAllocationStatus = "open" | "paused" | "locked";

export interface SaleAllocationProfileProps {
  saleId: string;
  status: SaleAllocationStatus;
  reason: string | null;
  until: Date | null;
  setBy: string | null;
  setAt: Date | null;
  rank: SaleRank;
  capNewPerDay: number | null;
  capTotal: number | null;
  lastAssignedAt: Date | null;
}

export class SaleAllocationProfileEntity extends Entity<SaleAllocationProfileProps> {
  static createDefault(id: string, saleId: string, rank: SaleRank): SaleAllocationProfileEntity {
    return new SaleAllocationProfileEntity({
      id,
      props: {
        saleId,
        status: "open",
        reason: null,
        until: null,
        setBy: null,
        setAt: null,
        rank,
        capNewPerDay: null,
        capTotal: null,
        lastAssignedAt: null
      }
    });
  }

  get saleId(): string {
    return this.props.saleId;
  }

  get rank(): SaleRank {
    return this.props.rank;
  }

  /** Tạm dừng có thời hạn tự hết hiệu lực khi qua `until`. */
  isAccepting(now: Date): boolean {
    if (this.props.status === "open") return true;
    if (this.props.status === "paused" && this.props.until) {
      return this.props.until.getTime() <= now.getTime();
    }
    return false;
  }

  pause(reason: string, until: Date | null, by: string, at: Date): void {
    if (!reason?.trim()) throw new ArgumentInvalidException("Vui lòng nhập lý do tạm dừng");
    if (until && until.getTime() <= at.getTime()) {
      throw new ArgumentInvalidException("Thời hạn tạm dừng phải ở tương lai");
    }
    this._setProps({ status: "paused", reason: reason.trim(), until, setBy: by, setAt: at });
  }

  lock(reason: string, by: string, at: Date): void {
    if (!reason?.trim()) throw new ArgumentInvalidException("Vui lòng nhập lý do khoá nhận khách");
    this._setProps({ status: "locked", reason: reason.trim(), until: null, setBy: by, setAt: at });
  }

  open(by: string, at: Date): void {
    this._setProps({ status: "open", reason: null, until: null, setBy: by, setAt: at });
  }

  setCaps(capNewPerDay: number | null, capTotal: number | null): void {
    if (capNewPerDay !== null && !(capNewPerDay >= 0)) {
      throw new ArgumentInvalidException("Hạn mức khách mới/ngày phải >= 0");
    }
    if (capTotal !== null && !(capTotal >= 0)) {
      throw new ArgumentInvalidException("Hạn mức tổng khách phải >= 0");
    }
    this._setProps({ capNewPerDay, capTotal });
  }

  touchAssigned(at: Date): void {
    this._setProps({ lastAssignedAt: at });
  }

  validate(): void {
    if (!this.props.saleId) throw new ArgumentInvalidException("Hồ sơ nhận khách thiếu saleId");
    if (!["open", "paused", "locked"].includes(this.props.status)) {
      throw new ArgumentInvalidException("Trạng thái nhận khách không hợp lệ");
    }
    if (!["A", "B", "C", "D"].includes(this.props.rank)) {
      throw new ArgumentInvalidException("Hạng Sale không hợp lệ");
    }
  }
}

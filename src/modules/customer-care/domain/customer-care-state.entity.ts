import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException, ConflictException } from "../../../core/exceptions/exceptions";
import { PriorityClass } from "./care-policy";

// Trạng thái chăm sóc của 1 khách (1 bản ghi / khách). Đây là "Pool" của Quy định 183A:
// in_pool = kho chung chưa thuộc Sale nào; nurturing = đã qua đủ số vòng Sale, chuyển CSKH nuôi dưỡng.

export type PoolStatus = "in_pool" | "assigned" | "nurturing" | "converted" | "excluded";

export interface CustomerCareStateProps {
  customerId: string;
  appId: string;
  poolStatus: PoolStatus;
  priorityClass: PriorityClass;
  roundCount: number;
  currentAssignmentId: string | null;
  currentSaleId: string | null;
  previousSaleIds: string[];
  enteredPoolAt: Date | null;
  convertedAt: Date | null;
  statusReason: string | null;
  /** Ưu tiên thấp (vd khách dưới 18 tuổi): vẫn ở kho chung nhưng phân sau mọi khách khác */
  lowPriority: boolean;
}

export class CustomerCareStateEntity extends Entity<CustomerCareStateProps> {
  static create(input: {
    id: string;
    customerId: string;
    appId: string;
    priorityClass: PriorityClass;
    at: Date;
  }): CustomerCareStateEntity {
    return new CustomerCareStateEntity({
      id: input.id,
      props: {
        customerId: input.customerId,
        appId: input.appId,
        poolStatus: "in_pool",
        priorityClass: input.priorityClass,
        roundCount: 0,
        currentAssignmentId: null,
        currentSaleId: null,
        previousSaleIds: [],
        enteredPoolAt: input.at,
        convertedAt: null,
        statusReason: null,
        lowPriority: false
      }
    });
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get poolStatus(): PoolStatus {
    return this.props.poolStatus;
  }

  get priorityClass(): PriorityClass {
    return this.props.priorityClass;
  }

  get roundCount(): number {
    return this.props.roundCount;
  }

  get currentAssignmentId(): string | null {
    return this.props.currentAssignmentId;
  }

  get currentSaleId(): string | null {
    return this.props.currentSaleId;
  }

  get previousSaleIds(): string[] {
    return [...this.props.previousSaleIds];
  }

  /** Giao cho Sale — mỗi lần giao là 1 vòng Sale mới. */
  assign(assignmentId: string, saleId: string): number {
    if (this.props.poolStatus === "converted") {
      throw new ConflictException("Khách đã chuyển đổi, không phân lại theo luồng khách mới");
    }
    if (this.props.poolStatus === "assigned") {
      throw new ConflictException("Khách đang có Sale phụ trách");
    }
    const roundCount = this.props.roundCount + 1;
    this._setProps({
      poolStatus: "assigned",
      roundCount,
      currentAssignmentId: assignmentId,
      currentSaleId: saleId,
      enteredPoolAt: null,
      statusReason: null
    });
    return roundCount;
  }

  /**
   * Sale bị thu hồi / trả khách. Chưa đủ số vòng → về Pool để phân Sale khác; đã đủ số vòng mà chưa
   * chuyển đổi → nhóm C, chuyển CSKH nuôi dưỡng (Điều 8.3).
   */
  release(at: Date, maxSaleRounds: number, reason: string | null): PoolStatus {
    if (this.props.poolStatus !== "assigned") {
      throw new ConflictException("Khách không ở trạng thái đang được giao");
    }
    const previousSaleIds = this.props.currentSaleId
      ? Array.from(new Set([...this.props.previousSaleIds, this.props.currentSaleId]))
      : this.props.previousSaleIds;
    const toNurturing = this.props.roundCount >= maxSaleRounds;
    this._setProps({
      poolStatus: toNurturing ? "nurturing" : "in_pool",
      priorityClass: toNurturing ? "C" : this.props.priorityClass,
      currentAssignmentId: null,
      currentSaleId: null,
      previousSaleIds,
      enteredPoolAt: at,
      statusReason: reason
    });
    return this.props.poolStatus;
  }

  /** Khách nuôi dưỡng có nhu cầu mới → quay lại Pool, tính lại vòng Sale từ đầu (Điều 8.3). */
  returnToPool(at: Date, priorityClass: "A" | "B", reason: string | null): void {
    if (!["nurturing", "excluded"].includes(this.props.poolStatus)) {
      throw new ConflictException("Chỉ đưa về Pool khách đang nuôi dưỡng hoặc đang bị loại");
    }
    this._setProps({
      poolStatus: "in_pool",
      priorityClass,
      roundCount: 0,
      previousSaleIds: [],
      enteredPoolAt: at,
      statusReason: reason
    });
  }

  get lowPriority(): boolean {
    return this.props.lowPriority;
  }

  setLowPriority(lowPriority: boolean): void {
    if (this.props.lowPriority === lowPriority) return;
    this._setProps({ lowPriority });
  }

  reclassify(priorityClass: "A" | "B"): void {
    if (this.props.poolStatus === "nurturing" || this.props.poolStatus === "converted") return;
    this._setProps({ priorityClass });
  }

  markConverted(at: Date): void {
    this._setProps({
      poolStatus: "converted",
      currentAssignmentId: null,
      convertedAt: at,
      enteredPoolAt: null
    });
  }

  exclude(reason: string): void {
    if (this.props.poolStatus === "assigned") {
      throw new ConflictException("Phải thu hồi khách khỏi Sale trước khi loại khỏi Pool");
    }
    this._setProps({ poolStatus: "excluded", enteredPoolAt: null, statusReason: reason });
  }

  validate(): void {
    const p = this.props;
    if (!p.customerId || !p.appId) {
      throw new ArgumentInvalidException("Trạng thái chăm sóc thiếu customerId/appId");
    }
    if (!["in_pool", "assigned", "nurturing", "converted", "excluded"].includes(p.poolStatus)) {
      throw new ArgumentInvalidException("Trạng thái Pool không hợp lệ");
    }
    if (p.poolStatus === "assigned" && (!p.currentAssignmentId || !p.currentSaleId)) {
      throw new ArgumentInvalidException("Khách đang được giao phải có lượt giao và Sale");
    }
  }
}

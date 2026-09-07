import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export type SaleOmicallProfileStatus = "active" | "transferring";

export interface SaleOmicallProfileProps {
  saleId: string;
  sipRealm: string;
  omicallExtension: string;
  sipPassword: string;
  omicallAgentId: string | null;
  omicallEmail: string;
  status: SaleOmicallProfileStatus;
  pendingTransferRequestId: string | null;
  pendingTransferTargetSaleId: string | null;
}

export interface CreateSaleOmicallProfileInput {
  id: string;
  saleId: string;
  sipRealm: string;
  omicallExtension: string;
  sipPassword: string;
  omicallAgentId?: string | null;
  omicallEmail: string;
}

export interface UpdateSaleOmicallProfileInput {
  sipRealm: string;
  omicallExtension: string;
  sipPassword: string;
  omicallAgentId?: string | null;
  omicallEmail: string;
}

export class SaleOmicallProfileEntity extends Entity<SaleOmicallProfileProps> {
  static create({
    id,
    saleId,
    sipRealm,
    omicallExtension,
    sipPassword,
    omicallAgentId,
    omicallEmail
  }: CreateSaleOmicallProfileInput): SaleOmicallProfileEntity {
    return new SaleOmicallProfileEntity({
      id,
      props: {
        saleId,
        sipRealm,
        omicallExtension,
        sipPassword,
        omicallAgentId: omicallAgentId ?? null,
        omicallEmail,
        status: "active",
        pendingTransferRequestId: null,
        pendingTransferTargetSaleId: null
      }
    });
  }

  get saleId(): string {
    return this.props.saleId;
  }

  get sipRealm(): string {
    return this.props.sipRealm;
  }

  get omicallExtension(): string {
    return this.props.omicallExtension;
  }

  get sipPassword(): string {
    return this.props.sipPassword;
  }

  get omicallAgentId(): string | null {
    return this.props.omicallAgentId;
  }

  get omicallEmail(): string {
    return this.props.omicallEmail;
  }

  get status(): SaleOmicallProfileStatus {
    return this.props.status;
  }

  get pendingTransferRequestId(): string | null {
    return this.props.pendingTransferRequestId;
  }

  get pendingTransferTargetSaleId(): string | null {
    return this.props.pendingTransferTargetSaleId;
  }

  update(input: UpdateSaleOmicallProfileInput): void {
    this._setProps({ ...input, omicallAgentId: input.omicallAgentId ?? null });
  }

  beginTransfer(requestId: string | null, targetSaleId: string): void {
    if (this.props.status === "transferring") {
      throw new ArgumentInvalidException("Nhân viên này đang có 1 giao dịch chuyển giao khác");
    }
    this._setProps({
      status: "transferring",
      pendingTransferRequestId: requestId,
      pendingTransferTargetSaleId: targetSaleId
    });
  }

  completeTransferSuccess(newOmicallEmail: string): void {
    if (this.props.status !== "transferring" || !this.props.pendingTransferTargetSaleId) {
      throw new ArgumentInvalidException("Không có giao dịch chuyển giao đang chờ để hoàn tất");
    }
    this._setProps({
      saleId: this.props.pendingTransferTargetSaleId,
      omicallEmail: newOmicallEmail,
      status: "active",
      pendingTransferRequestId: null,
      pendingTransferTargetSaleId: null
    });
  }

  completeTransferFailure(): void {
    this._setProps({
      status: "active",
      pendingTransferRequestId: null,
      pendingTransferTargetSaleId: null
    });
  }

  validate(): void {
    if (!this.props.saleId || typeof this.props.saleId !== "string") {
      throw new ArgumentInvalidException("SaleOmicallProfile thiếu saleId hợp lệ");
    }
    if (!this.props.sipRealm || typeof this.props.sipRealm !== "string") {
      throw new ArgumentInvalidException("SaleOmicallProfile thiếu sipRealm hợp lệ");
    }
    if (!this.props.omicallExtension || typeof this.props.omicallExtension !== "string") {
      throw new ArgumentInvalidException("SaleOmicallProfile thiếu omicallExtension hợp lệ");
    }
    if (!this.props.sipPassword || typeof this.props.sipPassword !== "string") {
      throw new ArgumentInvalidException("SaleOmicallProfile thiếu sipPassword hợp lệ");
    }
    if (this.props.omicallAgentId !== null && typeof this.props.omicallAgentId !== "string") {
      throw new ArgumentInvalidException("SaleOmicallProfile.omicallAgentId không hợp lệ");
    }
    if (!this.props.omicallEmail || typeof this.props.omicallEmail !== "string") {
      throw new ArgumentInvalidException("SaleOmicallProfile thiếu omicallEmail hợp lệ");
    }
    if (this.props.status !== "active" && this.props.status !== "transferring") {
      throw new ArgumentInvalidException("SaleOmicallProfile.status không hợp lệ");
    }
    if (
      this.props.pendingTransferTargetSaleId !== null &&
      typeof this.props.pendingTransferTargetSaleId !== "string"
    ) {
      throw new ArgumentInvalidException(
        "SaleOmicallProfile.pendingTransferTargetSaleId không hợp lệ"
      );
    }
  }
}

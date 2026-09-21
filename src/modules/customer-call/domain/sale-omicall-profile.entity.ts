import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export interface SaleOmicallProfileProps {
  saleId: string;
  sipRealm: string;
  omicallExtension: string;
  sipPassword: string;
  omicallAgentId: string | null;
  omicallEmail: string;
  hotlineNumbers: string[];
}

export interface CreateSaleOmicallProfileInput {
  id: string;
  saleId: string;
  sipRealm: string;
  omicallExtension: string;
  sipPassword: string;
  omicallAgentId?: string | null;
  omicallEmail: string;
  hotlineNumbers?: string[];
}

export interface UpdateSaleOmicallProfileInput {
  sipRealm: string;
  omicallExtension: string;
  sipPassword: string;
  omicallAgentId?: string | null;
  omicallEmail: string;
  hotlineNumbers?: string[];
}

export class SaleOmicallProfileEntity extends Entity<SaleOmicallProfileProps> {
  static create({
    id,
    saleId,
    sipRealm,
    omicallExtension,
    sipPassword,
    omicallAgentId,
    omicallEmail,
    hotlineNumbers
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
        hotlineNumbers: hotlineNumbers ?? []
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

  get hotlineNumbers(): string[] {
    return this.props.hotlineNumbers;
  }

  update(input: UpdateSaleOmicallProfileInput): void {
    this._setProps({
      ...input,
      omicallAgentId: input.omicallAgentId ?? null,
      hotlineNumbers: input.hotlineNumbers ?? this.props.hotlineNumbers
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
    if (!Array.isArray(this.props.hotlineNumbers)) {
      throw new ArgumentInvalidException("SaleOmicallProfile.hotlineNumbers không hợp lệ");
    }
  }
}

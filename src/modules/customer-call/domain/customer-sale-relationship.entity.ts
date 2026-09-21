import { Entity } from "../../../core/ddd/entity.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export type CustomerSaleRelationshipStatus = "not_friended" | "friended" | "friended_no_response";

const VALID_STATUSES: CustomerSaleRelationshipStatus[] = [
  "not_friended",
  "friended",
  "friended_no_response"
];

export interface CustomerSaleRelationshipProps {
  customerId: string;
  saleId: string;
  status: CustomerSaleRelationshipStatus;
  updatedBy: string;
}

export interface CreateCustomerSaleRelationshipInput {
  id: string;
  customerId: string;
  saleId: string;
  status: CustomerSaleRelationshipStatus;
  updatedBy: string;
}

export class CustomerSaleRelationshipEntity extends Entity<CustomerSaleRelationshipProps> {
  static create({
    id,
    customerId,
    saleId,
    status,
    updatedBy
  }: CreateCustomerSaleRelationshipInput): CustomerSaleRelationshipEntity {
    return new CustomerSaleRelationshipEntity({
      id,
      props: { customerId, saleId, status, updatedBy }
    });
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get saleId(): string {
    return this.props.saleId;
  }

  get status(): CustomerSaleRelationshipStatus {
    return this.props.status;
  }

  get updatedBy(): string {
    return this.props.updatedBy;
  }

  updateStatus(status: CustomerSaleRelationshipStatus, updatedBy: string): void {
    this._setProps({ status, updatedBy });
  }

  validate(): void {
    if (!this.props.customerId || typeof this.props.customerId !== "string") {
      throw new ArgumentInvalidException("CustomerSaleRelationship thiếu customerId hợp lệ");
    }
    if (!this.props.saleId || typeof this.props.saleId !== "string") {
      throw new ArgumentInvalidException("CustomerSaleRelationship thiếu saleId hợp lệ");
    }
    if (!VALID_STATUSES.includes(this.props.status)) {
      throw new ArgumentInvalidException("CustomerSaleRelationship.status không hợp lệ");
    }
    if (!this.props.updatedBy || typeof this.props.updatedBy !== "string") {
      throw new ArgumentInvalidException("CustomerSaleRelationship thiếu updatedBy hợp lệ");
    }
  }
}

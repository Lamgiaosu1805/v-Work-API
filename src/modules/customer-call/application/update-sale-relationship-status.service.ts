import mongoose from "mongoose";
import CustomerModel from "../../../models/CustomerModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { CustomerSaleRelationshipRepository } from "../infrastructure/customer-sale-relationship.repository";
import {
  CustomerSaleRelationshipEntity,
  CustomerSaleRelationshipStatus
} from "../domain/customer-sale-relationship.entity";

const customerSaleRelationshipRepository = new CustomerSaleRelationshipRepository();

export async function updateSaleRelationshipStatus(
  customerId: string,
  saleId: string,
  status: CustomerSaleRelationshipStatus,
  updatedBy: string
): Promise<CustomerSaleRelationshipEntity> {
  const customer = await CustomerModel.findOne({ _id: customerId, isDeleted: false }).lean();
  if (!customer) {
    throw new NotFoundException("Không tìm thấy khách hàng");
  }

  const existing = await customerSaleRelationshipRepository.findByCustomerAndSale(
    customerId,
    saleId
  );

  if (existing) {
    existing.updateStatus(status, updatedBy);
    const updated = await customerSaleRelationshipRepository.updateById(existing.id, existing);
    return updated as CustomerSaleRelationshipEntity;
  }

  const id = new mongoose.Types.ObjectId().toString();
  const relationship = CustomerSaleRelationshipEntity.create({
    id,
    customerId,
    saleId,
    status,
    updatedBy
  });
  await customerSaleRelationshipRepository.insert(relationship);
  return relationship;
}

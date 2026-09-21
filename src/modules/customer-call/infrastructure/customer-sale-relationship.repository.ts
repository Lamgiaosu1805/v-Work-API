import { MongooseRepositoryBase } from "../../../core/db/mongoose-repository.base";
import CustomerSaleRelationshipModel from "../../../models/CustomerSaleRelationshipModel";
import { CustomerSaleRelationshipEntity } from "../domain/customer-sale-relationship.entity";
import { customerSaleRelationshipMapper } from "./customer-sale-relationship.mapper";

export class CustomerSaleRelationshipRepository extends MongooseRepositoryBase<
  CustomerSaleRelationshipEntity,
  any
> {
  constructor() {
    super(CustomerSaleRelationshipModel, customerSaleRelationshipMapper);
  }

  async findByCustomerAndSale(
    customerId: string,
    saleId: string
  ): Promise<CustomerSaleRelationshipEntity | null> {
    const doc = await this.model
      .findOne({ customer_id: customerId, sale_id: saleId, isDeleted: false })
      .session(this.session ?? null)
      .lean();
    return doc ? this.mapper.toDomain(doc) : null;
  }
}

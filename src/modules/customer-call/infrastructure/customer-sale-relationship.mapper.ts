import {
  CustomerSaleRelationshipEntity,
  CustomerSaleRelationshipProps
} from "../domain/customer-sale-relationship.entity";
import { Mapper } from "../../../core/db/mongoose-repository.base";

export const customerSaleRelationshipMapper: Mapper<CustomerSaleRelationshipEntity, any> = {
  toDomain(record) {
    return new CustomerSaleRelationshipEntity(
      {
        id: String(record._id),
        props: {
          customerId: String(record.customer_id),
          saleId: String(record.sale_id),
          status: record.status,
          updatedBy: String(record.updated_by)
        } as CustomerSaleRelationshipProps,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        isDeleted: record.isDeleted
      },
      { validate: false }
    );
  },

  toPersistence(entity) {
    const props = entity.getProps();
    return {
      _id: props.id,
      customer_id: props.customerId,
      sale_id: props.saleId,
      status: props.status,
      updated_by: props.updatedBy
    };
  }
};

import { Ability, toMongoQuery } from "../../permission";
import CustomerModel from "../../../models/CustomerModel";
import { ForbiddenException, NotFoundException } from "../../../core/exceptions/exceptions";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";

export async function recordCallAttempt(ability: Ability, customerId: string): Promise<void> {
  const customerExists = await CustomerModel.exists({ _id: customerId, isDeleted: false });
  if (!customerExists) {
    throw new NotFoundException("Không tìm thấy khách hàng");
  }

  const scopeFilter = castObjectIdFields(toMongoQuery(ability, "customer_call.view", "Customer"), [
    "referred_by"
  ]);
  const inScope = await CustomerModel.exists({
    $and: [scopeFilter, { _id: customerId, isDeleted: false }]
  });
  if (!inScope) {
    throw new ForbiddenException("Bạn không có quyền gọi cho khách hàng này");
  }
}

const CustomerModel = require("../models/CustomerModel");
const { toMongoQuery, canOnSubject } = require("../modules/permission");

const canAccessCustomer = async (
  ability,
  customer,
  action = "customer.view",
  { allowUnassigned = false } = {}
) => {
  if (!customer.referred_by) return allowUnassigned;

  const scopeFilter = toMongoQuery(ability, action, "Customer");
  if (Object.keys(scopeFilter).length === 0) return true;

  return Boolean(await CustomerModel.exists({ _id: customer._id, ...scopeFilter }));
};

const canManageSale = async (ability, saleId) =>
  canOnSubject(ability, "customer.assign", "Customer", { referred_by: saleId });

module.exports = {
  canAccessCustomer,
  canManageSale
};

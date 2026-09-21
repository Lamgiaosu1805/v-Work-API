const CustomerModel = require("../models/CustomerModel");
const { toMongoQuery } = require("../modules/permission");

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

const canManageSale = async (ability, saleId) => {
  const scopeFilter = toMongoQuery(ability, "customer.assign", "Customer");
  if (Object.keys(scopeFilter).length === 0) return true;

  return String(scopeFilter.referred_by?.$eq) === String(saleId);
};

module.exports = {
  canAccessCustomer,
  canManageSale
};

const { canOnSubject } = require("../modules/permission");

const canAccessCustomer = async (
  ability,
  customer,
  action = "customer.view",
  { allowUnassigned = false } = {}
) => {
  if (canOnSubject(ability, action, "Customer", customer)) return true;
  if (!customer.referred_by) return allowUnassigned;
  return false;
};

const canManageSale = async (ability, saleId) =>
  canOnSubject(ability, "customer.assign", "Customer", { referred_by: saleId });

module.exports = {
  canAccessCustomer,
  canManageSale
};

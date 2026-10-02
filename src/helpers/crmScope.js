const mongoose = require("mongoose");
const UserInfoModel = require("../models/UserInfoModel");
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

const resolveCustomerScope = async (ability, accountId, action = "customer.view") => {
  const isUnrestricted = canOnSubject(ability, action, "Customer", {
    referred_by: new mongoose.Types.ObjectId()
  });
  if (isUnrestricted) return { isUnrestricted: true, myEmployeeId: null };

  const myUserInfo = await UserInfoModel.findOne({ id_account: accountId }).select("_id");
  return { isUnrestricted: false, myEmployeeId: myUserInfo?._id ?? null };
};

module.exports = {
  canAccessCustomer,
  canManageSale,
  resolveCustomerScope
};

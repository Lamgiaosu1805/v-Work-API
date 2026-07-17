const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");

const getCurrentUserInfo = (accountId) =>
  UserInfoModel.findOne({ id_account: accountId, isDeleted: false }).select("_id").lean();

const getScopedSaleIds = async (account) => {
  if (account.role === "admin" || account.dept_scope === "all") return null;

  const currentUser = await getCurrentUserInfo(account._id);
  if (!currentUser) return [];
  if (account.role !== "manager") return [currentUser._id];

  const departmentIds = await UserDepartmentPositionModel.distinct("department", {
    user: currentUser._id,
    isDeleted: false
  });
  return UserDepartmentPositionModel.distinct("user", {
    department: { $in: departmentIds },
    isDeleted: false
  });
};

const hasId = (ids, id) => ids.some((item) => String(item) === String(id));

const canAccessCustomer = async (account, customer, { allowUnassigned = false } = {}) => {
  if (account.role === "admin" || account.dept_scope === "all") return true;
  if (!customer.referred_by) return allowUnassigned && account.role === "manager";

  const saleIds = await getScopedSaleIds(account);
  return hasId(saleIds, customer.referred_by);
};

const canManageSale = async (account, saleId) => {
  if (account.role === "admin" || account.dept_scope === "all") return true;
  const saleIds = await getScopedSaleIds(account);
  return hasId(saleIds, saleId);
};

module.exports = {
  canAccessCustomer,
  canManageSale,
  getCurrentUserInfo,
  getScopedSaleIds
};

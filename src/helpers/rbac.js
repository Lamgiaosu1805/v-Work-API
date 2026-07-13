const RolePermissionModel = require("../models/RolePermissionModel");
const UserRoleModel = require("../models/UserRoleModel");
const UserPermissionModel = require("../models/UserPermissionModel");
const PermissionModel = require("../models/PermissionModel");
const redis = require("../config/redis");
const { mergePermissions } = require("./rbacResolve");
const { ROLE } = require("../constants");

const RBAC_CACHE_TTL = 60;

async function getEffectivePermissions(accountId) {
  const accountIdStr = String(accountId);
  const cacheKey = `rbac:perms:${accountIdStr}`;

  const cachedPermissions = await redis.get(cacheKey);
  if (cachedPermissions) return new Set(JSON.parse(cachedPermissions));

  const resolveRoleGrantedCodes = async () => {
    const assignedRoles = await UserRoleModel.find({ user: accountIdStr, isDeleted: false })
      .select("role")
      .lean();
    const assignedRoleIds = assignedRoles.map((assignment) => assignment.role);
    if (!assignedRoleIds.length) return [];

    const rolePermissionLinks = await RolePermissionModel.find({
      role: { $in: assignedRoleIds },
      isDeleted: false
    })
      .populate("permission", "code")
      .lean();
    return rolePermissionLinks
      .map((link) => link.permission && link.permission.code)
      .filter(Boolean);
  };

  const resolveUserOverrides = async () => {
    const overrideDocs = await UserPermissionModel.find({ user: accountIdStr, isDeleted: false })
      .populate("permission", "code")
      .lean();
    return overrideDocs
      .filter((override) => override.permission && override.permission.code)
      .map((override) => ({ code: override.permission.code, effect: override.effect }));
  };

  const [roleGrantedCodes, userOverrides] = await Promise.all([
    resolveRoleGrantedCodes(),
    resolveUserOverrides()
  ]);

  const effectivePermissions = mergePermissions(roleGrantedCodes, userOverrides);

  redis.setex(cacheKey, RBAC_CACHE_TTL, JSON.stringify([...effectivePermissions]));

  return effectivePermissions;
}

function invalidateRbacCache(accountId) {
  redis.del(`rbac:perms:${String(accountId)}`);
}

async function can(account, ...requiredCodes) {
  if (!account) return false;
  if (account.role === ROLE.ADMIN) return true;
  const effectivePermissions = await getEffectivePermissions(account._id);
  return requiredCodes.some((code) => effectivePermissions.has(code));
}

// Reverse-lookup permission -> role -> account. Chỉ tính permission gán qua role,
// KHÔNG tính override cá nhân qua UserPermissionModel (ALLOW trực tiếp không qua role).
async function getAccountsWithPermission(permissionCode) {
  const permission = await PermissionModel.findOne({ code: permissionCode, isDeleted: false });
  if (!permission) return [];

  const roleIds = await RolePermissionModel.find({
    permission: permission._id,
    isDeleted: false
  }).distinct("role");
  if (!roleIds.length) return [];

  return UserRoleModel.find({ role: { $in: roleIds }, isDeleted: false }).distinct("user");
}

function requirePermission(...requiredCodes) {
  return async (req, res, next) => {
    try {
      if (await can(req.account, ...requiredCodes)) return next();
      return res.status(403).json({
        errorCode: "FORBIDDEN",
        message: "Bạn không có quyền thực hiện thao tác này"
      });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi kiểm tra quyền", error: err.message });
    }
  };
}

module.exports = {
  mergePermissions,
  getEffectivePermissions,
  invalidateRbacCache,
  can,
  requirePermission,
  getAccountsWithPermission
};

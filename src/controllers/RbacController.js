const PermissionModel = require("../models/PermissionModel");
const RoleModel = require("../models/RoleModel");
const RolePermissionModel = require("../models/RolePermissionModel");
const UserRoleModel = require("../models/UserRoleModel");
const UserPermissionModel = require("../models/UserPermissionModel");
const AccountModel = require("../models/AccountModel");
const { getEffectivePermissions, invalidateRbacCache } = require("../helpers/rbac");
const { PERMISSION_EFFECT, PERMISSION_EFFECT_VALUES } = require("../constants");

const RbacController = {
  listPermissions: async (req, res) => {
    try {
      const perms = await PermissionModel.find({ isDeleted: false }).sort({ code: 1 }).lean();
      return res.status(200).json({ message: "OK", data: perms });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  listRoles: async (req, res) => {
    try {
      const roles = await RoleModel.find({ isDeleted: false }).sort({ code: 1 }).lean();
      const rolesIds = roles.map((r) => r._id);
      const links = await RolePermissionModel.find({
        role: { $in: rolesIds },
        isDeleted: false
      }).populate("permission", "code description");
      const data = roles.map((r) => ({
        ...r,
        permissions: links
          .filter((l) => String(l.role) === String(r._id) && l.permission)
          .map((l) => l.permission.code)
      }));
      return res.status(200).json({ message: "OK", data });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getUserAccess: async (req, res) => {
    try {
      const { accountId } = req.params;
      const account = await AccountModel.findById(accountId).lean();
      if (!account || account.isDeleted)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      const userRoles = await UserRoleModel.find({ user: accountId, isDeleted: false })
        .populate("role", "code name")
        .lean();
      const effective = await getEffectivePermissions(accountId);

      return res.status(200).json({
        message: "OK",
        data: {
          account: { _id: account._id, username: account.username, role: account.role },
          roles: userRoles.map((ur) => ur.role).filter(Boolean),
          effective_permissions: [...effective].sort()
        }
      });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  assignRole: async (req, res) => {
    try {
      const { accountId } = req.params;
      const { roleCode } = req.body;

      const account = await AccountModel.findById(accountId);
      if (!account || account.isDeleted)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      const role = await RoleModel.findOne({ code: roleCode, isDeleted: false });
      if (!role) return res.status(404).json({ message: "Không tìm thấy role" });

      const result = await UserRoleModel.updateOne(
        { user: accountId, role: role._id },
        { $setOnInsert: { user: accountId, role: role._id }, $set: { isDeleted: false } },
        { upsert: true }
      );
      await invalidateRbacCache(accountId);
      const alreadyAssigned = result.upsertedCount === 0 && result.modifiedCount === 0;
      return res.status(200).json({
        message: alreadyAssigned ? "Role đã được gán trước đó" : "Đã gán role"
      });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  revokeRole: async (req, res) => {
    try {
      const { accountId, roleCode } = req.params;
      const role = await RoleModel.findOne({ code: roleCode });
      if (!role) return res.status(404).json({ message: "Không tìm thấy role" });
      const account = await AccountModel.findById(accountId);
      if (!account || account.isDeleted)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      await UserRoleModel.updateOne(
        { user: accountId, role: role._id },
        { $set: { isDeleted: true } }
      );
      await invalidateRbacCache(accountId);
      return res.status(200).json({ message: "Đã bỏ role" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  setUserPermission: async (req, res) => {
    try {
      const { accountId } = req.params;
      const { permissionCode, effect } = req.body;
      if (!PERMISSION_EFFECT_VALUES.includes(effect))
        return res.status(400).json({
          message: `effect phải là '${PERMISSION_EFFECT.ALLOW}' hoặc '${PERMISSION_EFFECT.DENY}'`
        });

      const account = await AccountModel.findById(accountId);
      if (!account || account.isDeleted)
        return res.status(404).json({ message: "Không tìm thấy tài khoản" });

      const perm = await PermissionModel.findOne({ code: permissionCode, isDeleted: false });
      if (!perm) return res.status(404).json({ message: "Không tìm thấy permission" });

      await UserPermissionModel.updateOne(
        { user: accountId, permission: perm._id },
        {
          $set: { effect, isDeleted: false },
          $setOnInsert: { user: accountId, permission: perm._id }
        },
        { upsert: true }
      );
      await invalidateRbacCache(accountId);
      return res.status(200).json({ message: `Đã set override ${effect}` });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  removeUserPermission: async (req, res) => {
    try {
      const { accountId, permissionCode } = req.params;
      const perm = await PermissionModel.findOne({ code: permissionCode });
      if (!perm) return res.status(404).json({ message: "Không tìm thấy permission" });

      await UserPermissionModel.updateOne(
        { user: accountId, permission: perm._id },
        { $set: { isDeleted: true } }
      );
      await invalidateRbacCache(accountId);
      return res.status(200).json({ message: "Đã gỡ override" });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = RbacController;

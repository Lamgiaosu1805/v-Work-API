const { PERMISSION_EFFECT } = require("../constants");

function mergePermissions(roleGrantedCodes, userOverrides) {
  const effectivePermissions = new Set(roleGrantedCodes);
  for (const override of userOverrides) {
    if (override.effect === PERMISSION_EFFECT.ALLOW) effectivePermissions.add(override.code);
  }
  for (const override of userOverrides) {
    if (override.effect === PERMISSION_EFFECT.DENY) effectivePermissions.delete(override.code);
  }
  return effectivePermissions;
}

module.exports = { mergePermissions };

const roles = require("./roles");
const modules = require("./modules");
const deptScope = require("./deptScope");
const permissionEffect = require("./permissionEffect");
const permissions = require("./permissions");

module.exports = {
  ...roles,
  ...modules,
  ...deptScope,
  ...permissionEffect,
  ...permissions
};

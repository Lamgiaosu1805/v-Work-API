const PermissionCatalogModel = require("../../src/models/PermissionCatalogModel").default;
const DataScopePolicyModel = require("../../src/models/DataScopePolicyModel").default;
const PermissionRoleModel = require("../../src/models/PermissionRoleModel").default;
const EmployeePermissionProfileModel =
  require("../../src/models/EmployeePermissionProfileModel").default;

const ROLE_CODE = "TEST_REQUEST_ALL";

async function ensureRequestCatalogSeeded() {
  await DataScopePolicyModel.findOneAndUpdate(
    { code: "REQUEST_ALL_COMPANY" },
    { code: "REQUEST_ALL_COMPANY", entity: "Request", label: "Toàn công ty", conditionTree: null },
    { upsert: true }
  );

  const codes = ["request.view", "request.create", "request.cancel", "request.review"];
  await Promise.all(
    codes.map((code) =>
      PermissionCatalogModel.findOneAndUpdate(
        { code },
        {
          code,
          module: "hrm",
          name: code,
          entity: "Request",
          actionKind: code === "request.view" ? "READ" : "WRITE",
          supportsFieldScope: false,
          validDataScopePolicies: ["REQUEST_ALL_COMPANY"],
          validFieldScopePolicies: []
        },
        { upsert: true }
      )
    )
  );

  await PermissionRoleModel.findOneAndUpdate(
    { code: ROLE_CODE },
    {
      code: ROLE_CODE,
      name: "Test: full Request access",
      grants: codes.map((permissionCode) => ({
        permissionCode,
        dataScopePolicyCode: "REQUEST_ALL_COMPANY"
      }))
    },
    { upsert: true }
  );
}

async function grantRequestPermission(employeeId) {
  await ensureRequestCatalogSeeded();
  const role = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  await EmployeePermissionProfileModel.findOneAndUpdate(
    { employeeId },
    { employeeId, roleIds: [role._id], overrides: [] },
    { upsert: true }
  );
}

module.exports = { grantRequestPermission };

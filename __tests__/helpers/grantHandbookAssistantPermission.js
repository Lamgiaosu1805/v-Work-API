const PermissionCatalogModel = require("../../src/models/PermissionCatalogModel").default;
const DataScopePolicyModel = require("../../src/models/DataScopePolicyModel").default;
const PermissionRoleModel = require("../../src/models/PermissionRoleModel").default;
const EmployeePermissionProfileModel =
  require("../../src/models/EmployeePermissionProfileModel").default;

const ROLE_CODE = "TEST_HANDBOOK_ASSISTANT_USE";
const PERMISSION_CODE = "handbook_assistant.use";
const SCOPE_CODE = "HANDBOOK_ASSISTANT_ALL_COMPANY";

async function ensureHandbookAssistantCatalogSeeded() {
  await DataScopePolicyModel.findOneAndUpdate(
    { code: SCOPE_CODE },
    { code: SCOPE_CODE, entity: "HandbookAssistant", label: "Toàn công ty", conditionTree: null },
    { upsert: true }
  );
  await PermissionCatalogModel.findOneAndUpdate(
    { code: PERMISSION_CODE },
    {
      code: PERMISSION_CODE,
      module: "workplace",
      name: "Hỏi Trợ lý Nội quy (AI)",
      entity: "HandbookAssistant",
      actionKind: "WRITE",
      supportsFieldScope: false,
      validDataScopePolicies: [SCOPE_CODE],
      validFieldScopePolicies: []
    },
    { upsert: true }
  );
  await PermissionRoleModel.findOneAndUpdate(
    { code: ROLE_CODE },
    {
      code: ROLE_CODE,
      name: "Test: dùng Trợ lý Nội quy",
      grants: [{ permissionCode: PERMISSION_CODE, dataScopePolicyCode: SCOPE_CODE }]
    },
    { upsert: true }
  );
}

// Cấp quyền handbook_assistant.use cho nhân viên (UserInfo._id) qua role test.
async function grantHandbookAssistantPermission(employeeId) {
  await ensureHandbookAssistantCatalogSeeded();
  const role = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  await EmployeePermissionProfileModel.findOneAndUpdate(
    { employeeId },
    { employeeId, roleIds: [role._id], overrides: [] },
    { upsert: true }
  );
}

module.exports = { grantHandbookAssistantPermission };

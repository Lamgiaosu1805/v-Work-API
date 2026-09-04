import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import AccountModel from "../src/models/AccountModel";
import UserInfoModel from "../src/models/UserInfoModel";

const SALE_ROLE_CODE = "CRM_SALE";
const SALE_MANAGER_ROLE_CODE = "CRM_SALE_MANAGER";
const TEAM_LEAD_ROLE_CODE = "CRM_SALE_TEAM_LEAD";

const SALE_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "customer.view",
    dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer.claim",
    dataScopePolicyCode: "CUSTOMER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer.ai_insight",
    dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_interaction.view",
    dataScopePolicyCode: "CUSTOMER_INTERACTION_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_interaction.create",
    dataScopePolicyCode: "CUSTOMER_INTERACTION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "commission.view",
    dataScopePolicyCode: "COMMISSION_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_claim_request.create",
    dataScopePolicyCode: "CUSTOMER_CLAIM_REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_call.view",
    dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "call_log.view",
    dataScopePolicyCode: "CALL_LOG_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "call_log.update_note",
    dataScopePolicyCode: "CALL_LOG_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_call.initiate",
    dataScopePolicyCode: "SALE_OMICALL_PROFILE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_call.update_relationship_status",
    dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  }
];

const TEAM_LEAD_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "customer_call.view",
    dataScopePolicyCode: "CUSTOMER_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "call_log.view",
    dataScopePolicyCode: "CALL_LOG_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "call_log.update_note",
    dataScopePolicyCode: "CALL_LOG_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_call.initiate",
    dataScopePolicyCode: "SALE_OMICALL_PROFILE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_call.update_relationship_status",
    dataScopePolicyCode: "CUSTOMER_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  }
];

const SALE_MANAGER_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "customer.view",
    dataScopePolicyCode: "CUSTOMER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer.assign",
    dataScopePolicyCode: "CUSTOMER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer.claim",
    dataScopePolicyCode: "CUSTOMER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer.ai_insight",
    dataScopePolicyCode: "CUSTOMER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_interaction.view",
    dataScopePolicyCode: "CUSTOMER_INTERACTION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_interaction.create",
    dataScopePolicyCode: "CUSTOMER_INTERACTION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "agent.view",
    dataScopePolicyCode: "AGENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "investment.view",
    dataScopePolicyCode: "INVESTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "commission.view",
    dataScopePolicyCode: "COMMISSION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "claim_period.view",
    dataScopePolicyCode: "CLAIM_PERIOD_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "claim_period.manage",
    dataScopePolicyCode: "CLAIM_PERIOD_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "claim_period.close",
    dataScopePolicyCode: "CLAIM_PERIOD_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_claim_request.view",
    dataScopePolicyCode: "CUSTOMER_CLAIM_REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_claim_request.create",
    dataScopePolicyCode: "CUSTOMER_CLAIM_REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "customer_claim_request.review",
    dataScopePolicyCode: "CUSTOMER_CLAIM_REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "dashboard_metric.view",
    dataScopePolicyCode: "DASHBOARD_METRIC_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(
  code: string,
  name: string,
  description: string,
  grants: PermissionGrantDoc[]
): Promise<mongoose.Types.ObjectId> {
  const existing = await PermissionRoleModel.findOne({ code });
  const payload = { name, description, isSystemRole: true, grants, isDeleted: false };

  if (!existing) {
    const created = await PermissionRoleModel.create({ code, ...payload });
    console.log(`✅ Tạo role: ${code} (${grants.length} permission)`);
    return created._id as mongoose.Types.ObjectId;
  }

  const existingId = existing._id as mongoose.Types.ObjectId;
  const existingPlain = existing.toObject();
  const isSame =
    !existing.isDeleted &&
    existingPlain.name === payload.name &&
    existingPlain.description === payload.description &&
    existingPlain.isSystemRole === payload.isSystemRole &&
    isEqual(existingPlain.grants, payload.grants);

  if (isSame) {
    console.log(`⏭  Bỏ qua (đã đúng): role ${code}`);
    return existingId;
  }

  await PermissionRoleModel.updateOne({ _id: existingId }, { $set: payload });
  console.log(`♻️  Cập nhật role: ${code} (${grants.length} permission)`);
  return existingId;
}

interface AccountGroup {
  label: string;
  roleId: mongoose.Types.ObjectId;
  filter: Record<string, unknown>;
}

async function assignRoleToGroup(group: AccountGroup): Promise<void> {
  const accounts = await AccountModel.find({
    module_access: "crm",
    isDeleted: false,
    ...group.filter
  }).lean();

  if (!accounts.length) {
    console.log(`⚠️  [${group.label}] không tìm thấy account nào`);
    return;
  }

  let assigned = 0;
  let skipped = 0;
  let missingUserInfo = 0;

  for (const account of accounts) {
    const userInfo = await UserInfoModel.findOne({
      id_account: account._id,
      isDeleted: false
    }).lean();
    if (!userInfo) {
      console.warn(`⚠️  Account ${account.username} chưa có user_info — bỏ qua, gán tay sau`);
      missingUserInfo++;
      continue;
    }

    const employeeId = userInfo._id;
    const existingProfile = await EmployeePermissionProfileModel.findOne({ employeeId });

    if (!existingProfile) {
      await EmployeePermissionProfileModel.create({
        employeeId,
        roleIds: [group.roleId],
        overrides: []
      });
      assigned++;
      continue;
    }

    const alreadyHasRole = existingProfile.roleIds.some((id) => id.equals(group.roleId));
    if (existingProfile.isDeleted || !alreadyHasRole) {
      await EmployeePermissionProfileModel.updateOne(
        { _id: existingProfile._id },
        { $set: { isDeleted: false }, $addToSet: { roleIds: group.roleId } }
      );
      assigned++;
      continue;
    }

    skipped++;
  }

  console.log(
    `👤 [${group.label}] gán/cập nhật ${assigned}, bỏ qua ${skipped}, thiếu user_info ${missingUserInfo} (tổng ${accounts.length})`
  );
}

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công\n");

  const saleRoleId = await upsertRole(
    SALE_ROLE_CODE,
    "Sale CRM",
    "Role hệ thống — nhân viên sale CRM, chỉ xem/thao tác dữ liệu khách hàng do mình phụ trách.",
    SALE_GRANTS
  );
  const saleManagerRoleId = await upsertRole(
    SALE_MANAGER_ROLE_CODE,
    "Sale CRM Manager",
    "Role hệ thống — quản lý CRM, xem/quản lý toàn bộ dữ liệu khách hàng công ty.",
    SALE_MANAGER_GRANTS
  );
  await upsertRole(
    TEAM_LEAD_ROLE_CODE,
    "Sale CRM Team Lead",
    "Role hệ thống — trưởng nhóm sale CRM, xem/gọi khách hàng trong phạm vi cùng phòng ban.",
    TEAM_LEAD_GRANTS
  );

  console.log("");
  await assignRoleToGroup({
    label: "Sale (role=user, dept_scope=own)",
    roleId: saleRoleId,
    filter: { role: "user", dept_scope: "own" }
  });
  await assignRoleToGroup({
    label: "Sale Manager (role=manager, dept_scope=own)",
    roleId: saleManagerRoleId,
    filter: { role: "manager", dept_scope: "own" }
  });
  await assignRoleToGroup({
    label: "Sale Manager (role=manager, dept_scope=all)",
    roleId: saleManagerRoleId,
    filter: { role: "manager", dept_scope: "all" }
  });

  console.log("\n🎉 Hoàn thành seed role CRM");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});

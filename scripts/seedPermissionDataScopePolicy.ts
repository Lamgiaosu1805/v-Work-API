// Chạy: npx ts-node --transpile-only scripts/seedPermissionDataScopePolicy.ts
//
// 7 entity có Data Scope thật (Employee/Request/Customer/Commission/WeeklyReport/InternalFile/Post) +
// 1 Policy generic "<ENTITY>_ALL_COMPANY" (conditionTree: null) cho từng entity còn lại trong
// permission_catalog. Toàn bộ đánh isSystemPolicy: true (không xoá/sửa được qua UI thường).
//
// InternalFile CHỈ có ALL_COMPANY/OWN_DEPARTMENT — thiếu tier ACL (DeptFolderPermission
// grantedUsers/grantedDepts), tạm bỏ qua theo yêu cầu, xem docs/PERMISSION-MODULE-PLAN.md mục
// "Ngoại lệ kiến trúc". Request KHÔNG có DIRECT_REPORTS — getApprovalChain() xử lý riêng (quyết định A).
import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import { ConditionTreeProps } from "../src/modules/permission/domain/value-objects/condition-tree.vo";

interface DataScopePolicyDef {
  code: string;
  entity: string;
  label: string;
  conditionTree: ConditionTreeProps | null;
}

// resource.<x> IN ${subject.departmentIds} — dùng chung cho mọi entity scope "cùng phòng ban".
const ownDepartmentCondition = (resourceDeptPath: string): ConditionTreeProps => ({
  operator: "AND",
  clauses: [
    {
      left: resourceDeptPath,
      operator: "IN",
      right: { type: "SUBJECT_REF", path: "subject.departmentIds" }
    }
  ]
});

// resource.<x> EQ ${subject.<y>} — dùng chung cho mọi entity scope "của chính mình".
const selfCondition = (resourcePath: string, subjectPath: string): ConditionTreeProps => ({
  operator: "AND",
  clauses: [
    {
      left: resourcePath,
      operator: "EQ",
      right: { type: "SUBJECT_REF", path: subjectPath }
    }
  ]
});

const ownDepartmentColleaguesCondition = (resourceUserPath: string): ConditionTreeProps => ({
  operator: "AND",
  clauses: [
    {
      left: resourceUserPath,
      operator: "IN",
      right: { type: "SUBJECT_REF", path: "subject.departmentColleagueUserIds" }
    }
  ]
});

// entity không cần phân biệt "của mình" vs "tất cả" — 1 policy generic, không lọc gì (conditionTree
// null = ability.can() không thêm điều kiện, xem toàn bộ nếu có permission).
const GENERIC_ALL_COMPANY_ENTITIES: Record<string, string> = {
  DEPARTMENT_ALL_COMPANY: "Department",
  POSITION_ALL_COMPANY: "Position",
  LABOR_CONTRACT_ALL_COMPANY: "LaborContract",
  ATTENDANCE_ALL_COMPANY: "Attendance",
  WIFI_CONFIG_ALL_COMPANY: "WifiConfig",
  SHIFT_CONFIG_ALL_COMPANY: "ShiftConfig",
  PAYROLL_ALL_COMPANY: "Payroll",
  DOCUMENT_ALL_COMPANY: "Document",
  DOCUMENT_TYPE_ALL_COMPANY: "DocumentType",
  INTERNAL_FILE_PERMISSION_ALL_COMPANY: "InternalFilePermission",
  HOLIDAY_ALL_COMPANY: "Holiday",
  EMPLOYMENT_STATUS_ALL_COMPANY: "EmploymentStatus",
  ATTENDANCE_MAPPING_ALL_COMPANY: "AttendanceMapping",
  BRANCH_ALL_COMPANY: "Branch",
  POST_COMMENT_ALL_COMPANY: "PostComment",
  SHARED_FOLDER_ALL_COMPANY: "SharedFolder",
  SHARED_FOLDER_PERMISSION_ALL_COMPANY: "SharedFolderPermission",
  SHARED_FOLDER_AUDIT_LOG_ALL_COMPANY: "SharedFolderAuditLog",
  KPI_METRIC_ALL_COMPANY: "KpiMetric",
  PRINT_JOB_ALL_COMPANY: "PrintJob",
  AGENT_ALL_COMPANY: "Agent",
  INVESTMENT_ALL_COMPANY: "Investment",
  CLAIM_PERIOD_ALL_COMPANY: "ClaimPeriod",
  CUSTOMER_CLAIM_REQUEST_ALL_COMPANY: "CustomerClaimRequest",
  TRANSACTION_ALL_COMPANY: "Transaction",
  DASHBOARD_METRIC_ALL_COMPANY: "DashboardMetric",
  AI_CHAT_ALL_COMPANY: "AiChat",
  APP_INTEGRATION_ALL_COMPANY: "AppIntegration",
  SALE_OMICALL_PROFILE_ALL_COMPANY: "SaleOmicallProfile"
};

const REAL_SCOPE_DEFINITIONS: DataScopePolicyDef[] = [
  // ---- Employee ----
  { code: "EMPLOYEE_ALL_COMPANY", entity: "Employee", label: "Toàn công ty", conditionTree: null },
  {
    code: "EMPLOYEE_OWN_DEPARTMENT",
    entity: "Employee",
    label: "Cùng phòng ban",
    conditionTree: ownDepartmentCondition("resource.departmentId")
  },
  {
    code: "EMPLOYEE_SELF",
    entity: "Employee",
    label: "Chỉ chính mình",
    conditionTree: selfCondition("resource._id", "subject.userId")
  },

  // ---- Request ----
  { code: "REQUEST_ALL_COMPANY", entity: "Request", label: "Toàn công ty", conditionTree: null },
  {
    code: "REQUEST_SELF",
    entity: "Request",
    label: "Chỉ đơn của chính mình",
    conditionTree: selfCondition("resource.user_id", "subject.userId")
  },

  // ---- Customer ----
  { code: "CUSTOMER_ALL_COMPANY", entity: "Customer", label: "Toàn công ty", conditionTree: null },
  {
    code: "CUSTOMER_SELF_ASSIGNED",
    entity: "Customer",
    label: "Chỉ khách hàng do mình giới thiệu",
    conditionTree: selfCondition("resource.referred_by", "subject.userId")
  },
  {
    code: "CUSTOMER_OWN_DEPARTMENT",
    entity: "Customer",
    label: "Cùng phòng ban",
    conditionTree: ownDepartmentColleaguesCondition("resource.referred_by")
  },

  // ---- Commission (backed bởi collection investment) ----
  {
    code: "COMMISSION_ALL_COMPANY",
    entity: "Commission",
    label: "Toàn công ty",
    conditionTree: null
  },
  {
    code: "COMMISSION_SELF_ASSIGNED",
    entity: "Commission",
    label: "Chỉ hoa hồng của chính mình",
    conditionTree: selfCondition("resource.commission.sale_id", "subject.userId")
  },

  // ---- WeeklyReport ----
  {
    code: "WEEKLY_REPORT_ALL_COMPANY",
    entity: "WeeklyReport",
    label: "Toàn công ty",
    conditionTree: null
  },
  {
    code: "WEEKLY_REPORT_OWN_DEPARTMENT",
    entity: "WeeklyReport",
    label: "Cùng phòng ban",
    conditionTree: ownDepartmentCondition("resource.department")
  },

  // ---- InternalFile (thiếu tier ACL DeptFolderPermission — xem ghi chú đầu file) ----
  {
    code: "INTERNAL_FILE_ALL_COMPANY",
    entity: "InternalFile",
    label: "Toàn công ty",
    conditionTree: null
  },
  {
    code: "INTERNAL_FILE_OWN_DEPARTMENT",
    entity: "InternalFile",
    label: "Cùng phòng ban",
    conditionTree: ownDepartmentCondition("resource.department")
  },

  // ---- Post ----
  { code: "POST_ALL_COMPANY", entity: "Post", label: "Toàn công ty", conditionTree: null },
  {
    code: "POST_SELF_ASSIGNED",
    entity: "Post",
    label: "Chỉ bài của chính mình",
    conditionTree: selfCondition("resource.author_id", "subject.accountId")
  },

  // ---- CustomerInteraction ----
  {
    code: "CUSTOMER_INTERACTION_ALL_COMPANY",
    entity: "CustomerInteraction",
    label: "Toàn công ty",
    conditionTree: null
  },
  {
    code: "CUSTOMER_INTERACTION_SELF_ASSIGNED",
    entity: "CustomerInteraction",
    label: "Chỉ tương tác do mình phụ trách",
    conditionTree: selfCondition("resource.sale_id", "subject.userId")
  },

  // ---- CallLog ----
  { code: "CALL_LOG_ALL_COMPANY", entity: "CallLog", label: "Toàn công ty", conditionTree: null },
  {
    code: "CALL_LOG_SELF_ASSIGNED",
    entity: "CallLog",
    label: "Chỉ cuộc gọi của chính mình",
    conditionTree: selfCondition("resource.sale_id", "subject.userId")
  },
  {
    code: "CALL_LOG_OWN_DEPARTMENT",
    entity: "CallLog",
    label: "Cùng phòng ban",
    conditionTree: ownDepartmentColleaguesCondition("resource.sale_id")
  }
];

const DEFINITIONS: DataScopePolicyDef[] = [
  ...REAL_SCOPE_DEFINITIONS,
  ...Object.entries(GENERIC_ALL_COMPANY_ENTITIES).map(
    ([code, entity]): DataScopePolicyDef => ({
      code,
      entity,
      label: "Toàn công ty",
      conditionTree: null
    })
  )
];

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const def of DEFINITIONS) {
    const existing = await DataScopePolicyModel.findOne({ code: def.code });
    const payload = {
      entity: def.entity,
      label: def.label,
      isSystemPolicy: true,
      conditionTree: def.conditionTree,
      isDeleted: false
    };

    if (!existing) {
      await DataScopePolicyModel.create({ code: def.code, ...payload });
      console.log(`✅ Tạo data_scope_policy: ${def.code}`);
      created++;
      continue;
    }

    const existingPlain = existing.toObject();
    const isSame =
      !existing.isDeleted &&
      existingPlain.entity === payload.entity &&
      existingPlain.label === payload.label &&
      existingPlain.isSystemPolicy === payload.isSystemPolicy &&
      isEqual(existingPlain.conditionTree, payload.conditionTree);

    if (isSame) {
      console.log(`⏭  Bỏ qua (đã đúng): ${def.code}`);
      skipped++;
      continue;
    }

    await DataScopePolicyModel.updateOne({ _id: existing._id }, { $set: payload });
    console.log(`♻️  Cập nhật data_scope_policy: ${def.code}`);
    updated++;
  }

  console.log(
    `\n🎉 Hoàn thành: tạo mới ${created}, cập nhật ${updated}, bỏ qua ${skipped} (tổng ${DEFINITIONS.length})`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});

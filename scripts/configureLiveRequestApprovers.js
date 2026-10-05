/**
 * Cấu hình người duyệt đơn từ HRM trên DB live.
 *
 * Phạm vi:
 * - Gán manager cho Ban Chính Sách Sản Phẩm và Khối Vận Hành.
 * - Gán Mai Ngọc Đoàn làm quản lý trực tiếp của Nguyễn Văn Lam và Đoàn Thị Kim Cúc.
 * - Bảo đảm cả ba người có quyền hrm.request.review; không cấp review_all.
 * - Hạ Nguyễn Quang Đạt từ admin xuống manager CRM vì không còn thuộc luồng duyệt đơn.
 *
 * Mặc định chỉ dry-run:
 *   node scripts/configureLiveRequestApprovers.js
 *
 * Ghi dữ liệu thật bằng transaction:
 *   node scripts/configureLiveRequestApprovers.js --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Redis = require("ioredis");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const PermissionModel = require("../src/models/PermissionModel");
const UserPermissionModel = require("../src/models/UserPermissionModel");

const LIVE_DB_NAME = "v_work_live_db";
const REVIEW_PERMISSION = "hrm.request.review";
const isApply = process.argv.includes("--apply");
const FORMER_REQUEST_APPROVER = "Nguyễn Quang Đạt";

const PEOPLE = {
  doan: "Mai Ngọc Đoàn",
  lam: "Nguyễn Văn Lam",
  cuc: "Đoàn Thị Kim Cúc"
};

const DEPARTMENT_ASSIGNMENTS = [
  {
    code: "BCSP",
    name: "Ban Chính Sách Sản Phẩm",
    targetPerson: "lam",
    allowedCurrentPeople: [null, "lam"]
  },
  {
    code: "K-VH",
    name: "Khối Vận Hành",
    targetPerson: "cuc",
    allowedCurrentPeople: ["lam", "cuc"]
  }
];

const id = (value) => (value == null ? null : String(value));

async function findExactlyOneActiveUser(fullName, session = null) {
  const query = UserInfoModel.find({ full_name: fullName, isDeleted: false })
    .select("_id full_name ma_nv id_account direct_manager")
    .lean();
  if (session) query.session(session);
  const matches = await query;
  if (matches.length !== 1) {
    throw new Error(
      `Cần đúng 1 user active tên '${fullName}', nhưng tìm thấy ${matches.length}. Dừng để tránh gán nhầm.`
    );
  }
  return matches[0];
}

async function loadContext(session = null) {
  const entries = await Promise.all(
    Object.entries(PEOPLE).map(async ([key, fullName]) => [
      key,
      await findExactlyOneActiveUser(fullName, session)
    ])
  );
  const people = Object.fromEntries(entries);
  const formerApprover = await findExactlyOneActiveUser(FORMER_REQUEST_APPROVER, session);

  const formerApproverAccountQuery = AccountModel.find({
    _id: formerApprover.id_account,
    isDeleted: false
  })
    .select("_id username role module_access dept_scope")
    .lean();
  if (session) formerApproverAccountQuery.session(session);
  const formerApproverAccounts = await formerApproverAccountQuery;
  if (formerApproverAccounts.length !== 1) {
    throw new Error(
      `Cần đúng 1 tài khoản active của '${FORMER_REQUEST_APPROVER}', nhưng tìm thấy ${formerApproverAccounts.length}.`
    );
  }

  const [managedDepartment, directReport] = await Promise.all([
    DepartmentModel.exists({ manager: formerApprover._id, isDeleted: false }).session(session),
    UserInfoModel.exists({ direct_manager: formerApprover._id, isDeleted: false }).session(session)
  ]);
  if (managedDepartment || directReport) {
    throw new Error(
      `${FORMER_REQUEST_APPROVER} vẫn đang được gán trong cấu hình quản lý mới; không tự hạ quyền.`
    );
  }

  const permissionRoles = await mongoose.connection.db
    .collection("permission_roles")
    .find(
      { code: { $in: ["PERMISSION_ADMIN", "CRM_SALE_MANAGER"] }, isDeleted: false },
      { session }
    )
    .toArray();
  const permissionAdminRole = permissionRoles.find((role) => role.code === "PERMISSION_ADMIN");
  const crmManagerRole = permissionRoles.find((role) => role.code === "CRM_SALE_MANAGER");
  if (!permissionAdminRole || !crmManagerRole) {
    throw new Error("Thiếu role CASL PERMISSION_ADMIN hoặc CRM_SALE_MANAGER trên live.");
  }
  const permissionProfile = await mongoose.connection.db
    .collection("employee_permission_profiles")
    .findOne({ employeeId: formerApprover._id, isDeleted: false }, { session });
  if (!permissionProfile) {
    throw new Error(`Không tìm thấy profile phân quyền CASL của '${FORMER_REQUEST_APPROVER}'.`);
  }
  if (!(permissionProfile.roleIds || []).some((roleId) => id(roleId) === id(crmManagerRole._id))) {
    throw new Error(
      `${FORMER_REQUEST_APPROVER} chưa có role CASL CRM_SALE_MANAGER; dừng để kiểm tra.`
    );
  }

  const permissionQuery = PermissionModel.find({
    code: REVIEW_PERMISSION,
    isDeleted: false
  }).lean();
  if (session) permissionQuery.session(session);
  const permissions = await permissionQuery;
  if (permissions.length !== 1) {
    throw new Error(
      `Cần đúng 1 permission active '${REVIEW_PERMISSION}', nhưng tìm thấy ${permissions.length}.`
    );
  }

  const departmentQuery = DepartmentModel.find({
    department_code: { $in: DEPARTMENT_ASSIGNMENTS.map((item) => item.code) },
    isDeleted: false
  })
    .select("_id department_code department_name manager")
    .lean();
  if (session) departmentQuery.session(session);
  const departments = await departmentQuery;

  for (const expected of DEPARTMENT_ASSIGNMENTS) {
    const matches = departments.filter((item) => item.department_code === expected.code);
    if (matches.length !== 1) {
      throw new Error(
        `Cần đúng 1 phòng ban active mã '${expected.code}', nhưng tìm thấy ${matches.length}.`
      );
    }
    if (matches[0].department_name !== expected.name) {
      throw new Error(
        `Tên phòng ban mã '${expected.code}' đã đổi thành '${matches[0].department_name}'. Dừng để kiểm tra.`
      );
    }
  }

  const accountIds = Object.values(people).map((person) => person.id_account);
  const overrideQuery = UserPermissionModel.find({
    user: { $in: accountIds },
    permission: permissions[0]._id
  })
    .select("_id user permission effect isDeleted")
    .lean();
  if (session) overrideQuery.session(session);
  const overrides = await overrideQuery;

  return {
    people,
    formerApprover,
    formerApproverAccount: formerApproverAccounts[0],
    formerApproverPermissionProfile: permissionProfile,
    permissionAdminRole,
    permission: permissions[0],
    departments,
    overrides
  };
}

function personById(context, userInfoId) {
  if (!userInfoId) return null;
  const entry = Object.entries(context.people).find(
    ([, person]) => id(person._id) === id(userInfoId)
  );
  return entry ? PEOPLE[entry[0]] : `UserInfo ${id(userInfoId)}`;
}

function assertSafeCurrentState(context) {
  const formerAccount = context.formerApproverAccount;
  const alreadyCrmManager =
    formerAccount.role === "manager" &&
    formerAccount.dept_scope === "own" &&
    JSON.stringify([...(formerAccount.module_access || [])].sort()) === JSON.stringify(["crm"]);
  if (formerAccount.role !== "admin" && !alreadyCrmManager) {
    throw new Error(
      `Tài khoản ${formerAccount.username} đang có cấu hình quyền khác trạng thái đã duyệt; dừng để kiểm tra.`
    );
  }

  for (const assignment of DEPARTMENT_ASSIGNMENTS) {
    const department = context.departments.find((item) => item.department_code === assignment.code);
    const currentKey = department.manager
      ? Object.entries(context.people).find(
          ([, person]) => id(person._id) === id(department.manager)
        )?.[0] || "unknown"
      : null;
    if (!assignment.allowedCurrentPeople.includes(currentKey)) {
      throw new Error(
        `${assignment.name} đang có manager '${personById(context, department.manager)}', không nằm trong trạng thái đã duyệt.`
      );
    }
  }

  for (const key of ["lam", "cuc"]) {
    const current = context.people[key].direct_manager;
    if (current && id(current) !== id(context.people.doan._id)) {
      throw new Error(
        `${PEOPLE[key]} đang có quản lý trực tiếp '${personById(context, current)}', không được tự động ghi đè.`
      );
    }
  }
}

function buildSnapshot(context) {
  return {
    tai_khoan_quan_ly_cu: {
      nhan_su: FORMER_REQUEST_APPROVER,
      username: context.formerApproverAccount.username,
      role: context.formerApproverAccount.role,
      module_access: context.formerApproverAccount.module_access || [],
      dept_scope: context.formerApproverAccount.dept_scope,
      casl_permission_admin: (context.formerApproverPermissionProfile.roleIds || []).some(
        (roleId) => id(roleId) === id(context.permissionAdminRole._id)
      )
    },
    phong_ban: DEPARTMENT_ASSIGNMENTS.map((assignment) => {
      const department = context.departments.find(
        (item) => item.department_code === assignment.code
      );
      return {
        ma: assignment.code,
        ten: assignment.name,
        manager: personById(context, department.manager)
      };
    }),
    quan_ly_truc_tiep: ["lam", "cuc"].map((key) => ({
      nhan_su: PEOPLE[key],
      manager: personById(context, context.people[key].direct_manager)
    })),
    quyen_duyet: Object.entries(context.people).map(([key, person]) => {
      const override = context.overrides.find((item) => id(item.user) === id(person.id_account));
      let status = "chưa có override";
      if (override)
        status = override.isDeleted ? `đã xóa mềm (${override.effect})` : override.effect;
      return {
        nhan_su: PEOPLE[key],
        trang_thai: status
      };
    })
  };
}

function printPlannedChanges(context) {
  console.log("\nThay đổi dự kiến:");
  const formerAccount = context.formerApproverAccount;
  const accountUnchanged =
    formerAccount.role === "manager" &&
    formerAccount.dept_scope === "own" &&
    JSON.stringify([...(formerAccount.module_access || [])].sort()) === JSON.stringify(["crm"]);
  console.log(
    `- ${FORMER_REQUEST_APPROVER} (${formerAccount.username}): role ${formerAccount.role} -> manager, ` +
      `module_access -> [crm], dept_scope -> own${accountUnchanged ? " (đã đúng, giữ nguyên)" : ""}`
  );
  const hasCaslAdmin = (context.formerApproverPermissionProfile.roleIds || []).some(
    (roleId) => id(roleId) === id(context.permissionAdminRole._id)
  );
  console.log(
    `- ${FORMER_REQUEST_APPROVER}: gỡ role CASL PERMISSION_ADMIN${
      hasCaslAdmin ? "" : " (đã gỡ, giữ nguyên)"
    }; giữ CRM_SALE_MANAGER`
  );
  for (const assignment of DEPARTMENT_ASSIGNMENTS) {
    const department = context.departments.find((item) => item.department_code === assignment.code);
    const before = personById(context, department.manager) || "Trống";
    const after = PEOPLE[assignment.targetPerson];
    console.log(
      `- ${assignment.name}: ${before} -> ${after}${before === after ? " (giữ nguyên)" : ""}`
    );
  }

  for (const key of ["lam", "cuc"]) {
    const before = personById(context, context.people[key].direct_manager) || "Trống";
    console.log(
      `- Quản lý trực tiếp của ${PEOPLE[key]}: ${before} -> ${PEOPLE.doan}${
        before === PEOPLE.doan ? " (giữ nguyên)" : ""
      }`
    );
  }

  for (const [key, person] of Object.entries(context.people)) {
    const override = context.overrides.find((item) => id(item.user) === id(person.id_account));
    const alreadyAllowed = override && !override.isDeleted && override.effect === "allow";
    console.log(
      `- ${PEOPLE[key]}: ${REVIEW_PERMISSION} = allow${alreadyAllowed ? " (đã đúng, giữ nguyên)" : ""}`
    );
  }
  console.log("- Không thay đổi quyền hrm.request.review_all.");
}

async function applyChanges(initialContext) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => {
        const context = await loadContext(session);
        assertSafeCurrentState(context);

        for (const assignment of DEPARTMENT_ASSIGNMENTS) {
          const department = context.departments.find(
            (item) => item.department_code === assignment.code
          );
          const target = context.people[assignment.targetPerson];
          await DepartmentModel.updateOne(
            { _id: department._id, isDeleted: false },
            { $set: { manager: target._id } },
            { session }
          );
        }

        for (const key of ["lam", "cuc"]) {
          await UserInfoModel.updateOne(
            { _id: context.people[key]._id, isDeleted: false },
            { $set: { direct_manager: context.people.doan._id } },
            { session }
          );
        }

        for (const person of Object.values(context.people)) {
          await UserPermissionModel.updateOne(
            { user: person.id_account, permission: context.permission._id },
            {
              $set: { effect: "allow", isDeleted: false },
              $setOnInsert: { user: person.id_account, permission: context.permission._id }
            },
            { upsert: true, session }
          );
        }

        await AccountModel.updateOne(
          { _id: context.formerApproverAccount._id, isDeleted: false },
          { $set: { role: "manager", module_access: ["crm"], dept_scope: "own" } },
          { session }
        );
        await mongoose.connection.db
          .collection("employee_permission_profiles")
          .updateOne(
            { _id: context.formerApproverPermissionProfile._id, isDeleted: false },
            { $pull: { roleIds: context.permissionAdminRole._id } },
            { session }
          );
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" }
      }
    );
  } catch (error) {
    console.error("\n❌ Ghi dữ liệu thất bại; transaction đã rollback:", error.message);
    throw error;
  } finally {
    await session.endSession();
  }

  const after = await loadContext();
  assertSafeCurrentState(after);
  console.log("\nTrạng thái sau khi ghi:");
  console.log(JSON.stringify(buildSnapshot(after), null, 2));

  const accountIds = [
    ...Object.values(initialContext.people).map((person) => id(person.id_account)),
    id(initialContext.formerApproverAccount._id)
  ];
  const redis = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.del(...accountIds.map((accountId) => `rbac:perms:${accountId}`));
    const envPrefix = (process.env.BASE_URL || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
    await redis.del(`${envPrefix}:perm:employee:${id(initialContext.formerApprover._id)}`);
    console.log("\n✅ Đã xóa cache RBAC của 4 tài khoản.");
  } catch (error) {
    console.warn(
      "\n⚠️ Không xóa được cache Redis; quyền mới sẽ tự cập nhật sau tối đa 60 giây.",
      error.message
    );
  } finally {
    redis.disconnect();
  }
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("Thiếu biến môi trường MONGODB_URI");

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: LIVE_DB_NAME,
    autoIndex: false,
    autoCreate: false
  });
  console.log(`Đã kết nối DB: ${LIVE_DB_NAME}`);
  console.log(isApply ? "Chế độ: APPLY" : "Chế độ: DRY-RUN (không ghi dữ liệu)");

  const before = await loadContext();
  assertSafeCurrentState(before);
  console.log("\nTrạng thái hiện tại:");
  console.log(JSON.stringify(buildSnapshot(before), null, 2));
  printPlannedChanges(before);

  if (!isApply) {
    console.log("\n✅ Dry-run hoàn tất, chưa ghi dữ liệu.");
    return;
  }

  await applyChanges(before);
  console.log("\n✅ Đã áp dụng cấu hình người duyệt đơn từ HRM trên DB live.");
}

run()
  .catch((error) => {
    console.error("❌ Lỗi:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

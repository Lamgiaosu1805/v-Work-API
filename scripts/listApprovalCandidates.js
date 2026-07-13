require("dotenv").config();
const mongoose = require("mongoose");
const AccountModel = require("../src/models/AccountModel");
const PositionModel = require("../src/models/PositionModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
require("../src/models/UserInfoModel");
require("../src/models/DepartmentModel");
const PermissionModel = require("../src/models/PermissionModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const UserRoleModel = require("../src/models/UserRoleModel");
const UserPermissionModel = require("../src/models/UserPermissionModel");
const { PERMISSION } = require("../src/constants");

const KEYWORDS = ["trưởng", "giám đốc", "quản lý", "trương", "giam doc", "quan ly"];

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

async function alreadyHasReviewPermission(account) {
  if (account.role === "admin") return true;

  const permission = await PermissionModel.findOne({
    code: PERMISSION.HRM_REQUEST_REVIEW,
    isDeleted: false
  });
  if (!permission) return false;

  const overrides = await UserPermissionModel.find({
    user: account._id,
    permission: permission._id,
    isDeleted: false
  });
  if (overrides.some((o) => o.effect === "deny")) return false;
  if (overrides.some((o) => o.effect === "allow")) return true;

  const roleIds = await UserRoleModel.find({ user: account._id, isDeleted: false }).distinct(
    "role"
  );
  if (!roleIds.length) return false;

  const hasLink = await RolePermissionModel.exists({
    role: { $in: roleIds },
    permission: permission._id,
    isDeleted: false
  });
  return !!hasLink;
}

const list = async () => {
  await connectDB();

  const keywordRegex = new RegExp(KEYWORDS.join("|"), "i");
  const positions = await PositionModel.find({
    isDeleted: false,
    position_name: keywordRegex
  });
  if (!positions.length) {
    console.log("Không tìm thấy position nào khớp từ khóa:", KEYWORDS.join(", "));
    process.exit(0);
  }

  const assignments = await UserDepartmentPositionModel.find({
    position: { $in: positions.map((p) => p._id) },
    isDeleted: false
  })
    .populate("user", "full_name ma_nv id_account isDeleted")
    .populate("department", "department_name department_code type")
    .populate("position", "position_name");

  console.log(`\nTìm thấy ${assignments.length} ứng viên khả nghi (theo tên chức vụ):\n`);

  let count = 0;
  for (const a of assignments) {
    const userInfo = a.user;
    if (!userInfo || userInfo.isDeleted || !a.department) continue;

    const account = await AccountModel.findOne({ _id: userInfo.id_account, isDeleted: false });
    if (!account) continue;

    const hasPermission = await alreadyHasReviewPermission(account);
    count += 1;
    console.log(
      `- ${userInfo.full_name} (${userInfo.ma_nv}) | chức vụ: ${a.position.position_name} | ` +
        `phòng ban: ${a.department.department_name} [${a.department.type}] | ` +
        `account: ${account.username} | ` +
        `đã có quyền duyệt: ${hasPermission ? "CÓ" : "chưa"}`
    );
  }

  console.log(
    `\nTổng ${count} ứng viên. Với người "chưa" có quyền, admin xác nhận rồi gán qua:\n` +
      `POST /rbac/users/:accountId/roles { "roleCode": "unit_head" }\n`
  );
  process.exit(0);
};

list().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});

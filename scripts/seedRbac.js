require("dotenv").config();
const mongoose = require("mongoose");
const PermissionModel = require("../src/models/PermissionModel");
const RoleModel = require("../src/models/RoleModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const { PERMISSION, PERMISSION_VALUES } = require("../src/constants");

const ROLES = [
  {
    code: "hr",
    name: "Nhân sự",
    description: "Xem toàn bộ đơn từ của nhân viên; import/chỉnh sửa chấm công",
    permissions: [
      PERMISSION.HRM_REQUEST_VIEW_ALL,
      PERMISSION.HRM_ATTENDANCE_IMPORT,
      PERMISSION.HRM_ATTENDANCE_EDIT
    ]
  },
  {
    code: "unit_head",
    name: "Trưởng đơn vị",
    description:
      "Duyệt đơn của nhân viên trong phạm vi phòng ban mình quản lý (xem docs/REQUEST-APPROVAL-CHAIN-PLAN.md)",
    permissions: [PERMISSION.HRM_REQUEST_REVIEW]
  }
];

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const seed = async () => {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const code of PERMISSION_VALUES) {
    const existing = await PermissionModel.findOne({ code });
    if (existing) {
      if (existing.isDeleted) {
        existing.isDeleted = false;
        await existing.save();
        console.log(`♻️  Khôi phục permission: ${code}`);
      } else {
        console.log(`⏭  Bỏ qua (đã có): ${code}`);
        skipped++;
      }
      continue;
    }
    await PermissionModel.create({ code, group: code.split(".")[0], description: code });
    console.log(`✅ Tạo permission: ${code}`);
    created++;
  }

  for (const roleDef of ROLES) {
    let role = await RoleModel.findOne({ code: roleDef.code });
    if (!role) {
      role = await RoleModel.create({
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description
      });
      console.log(`✅ Tạo role: ${roleDef.code} — ${roleDef.name}`);
    } else {
      console.log(`⏭  Bỏ qua role (đã có): ${roleDef.code}`);
    }

    for (const permCode of roleDef.permissions) {
      const permission = await PermissionModel.findOne({ code: permCode, isDeleted: false });
      if (!permission) {
        console.warn(`⚠️  Không tìm thấy permission ${permCode}, bỏ qua`);
        continue;
      }
      const link = await RolePermissionModel.findOne({
        role: role._id,
        permission: permission._id
      });
      if (link) {
        if (link.isDeleted) {
          link.isDeleted = false;
          await link.save();
          console.log(`♻️  Khôi phục gán ${permCode} → ${roleDef.code}`);
        }
        continue;
      }
      await RolePermissionModel.create({ role: role._id, permission: permission._id });
      console.log(`✅ Gán ${permCode} → ${roleDef.code}`);
    }
  }

  console.log(`\n🎉 Hoàn thành: tạo mới ${created}, bỏ qua ${skipped} permission đã tồn tại`);
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});

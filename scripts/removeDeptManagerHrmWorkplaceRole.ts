import "dotenv/config";
import mongoose from "mongoose";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";

const ROLE_CODE = "DEPT_MANAGER_HRM_WORKPLACE";

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  const role = await PermissionRoleModel.findOne({ code: ROLE_CODE, isDeleted: false });
  if (!role) {
    console.log(`⏭  Bỏ qua (đã xoá hoặc không tồn tại): role ${ROLE_CODE}`);
    process.exit(0);
  }

  const affected = await EmployeePermissionProfileModel.updateMany(
    { roleIds: role._id },
    { $pull: { roleIds: role._id } }
  );

  await PermissionRoleModel.updateOne({ _id: role._id }, { $set: { isDeleted: true } });

  console.log(
    `✅ Đã xoá role ${ROLE_CODE} — gỡ khỏi ${affected.modifiedCount} employee_permission_profile`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});

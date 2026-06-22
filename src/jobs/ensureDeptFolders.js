const fs = require("fs");
const path = require("path");
const DepartmentModel = require("../models/DepartmentModel");
const { LEAF_TYPES } = require("../models/DepartmentModel");

const getBaseDir = () => {
  const dir =
    process.env.NODE_ENV === "production"
      ? process.env.INTERNAL_DIR_PROD
      : process.env.INTERNAL_DIR_DEV;
  return path.resolve(dir);
};

// Tạo folder cho 1 phòng ban (dùng cả khi tạo mới lẫn khi sync)
function ensureFolderForDept(departmentCode) {
  const baseDir = getBaseDir();
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  const deptPath = path.join(baseDir, departmentCode);
  if (!fs.existsSync(deptPath)) {
    fs.mkdirSync(deptPath, { recursive: true });
    return true;
  }
  return false;
}

// Chạy khi server khởi động: tạo folder cho node lá (department + branch)
async function ensureAllDeptFolders() {
  try {
    const departments = await DepartmentModel.find({ isDeleted: false, type: { $in: LEAF_TYPES } });
    let created = 0;

    for (const dept of departments) {
      const wasCreated = ensureFolderForDept(dept.department_code);
      if (wasCreated) created++;
    }

    console.log(
      `[Internal Drive] Synced ${departments.length} phòng ban, tạo mới ${created} folder còn thiếu`
    );
  } catch (err) {
    console.error("[Internal Drive] Lỗi khi sync folder phòng ban:", err.message);
  }
}

module.exports = { ensureAllDeptFolders, ensureFolderForDept };

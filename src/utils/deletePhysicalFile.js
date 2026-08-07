const fs = require("fs");
const path = require("path");

function deletePhysicalFile(relativeFilePath) {
  // @param {string} relativeFilePaths
  if (!relativeFilePath) return;

  const absolutePath = path.join(__dirname, "../../uploads/public", relativeFilePath);

  fs.unlink(absolutePath, (err) => {
    if (err) {
      if (err.code === "ENOENT") {
        console.warn(`[File System] File không tồn tại để xóa: ${absolutePath}`);
      } else {
        console.error(`[File System] Lỗi khi xóa file: ${absolutePath}`, err.message);
      }
    } else {
      console.log(`[File System] Đã xóa file thành công: ${absolutePath}`);
    }
  });
}

module.exports = deletePhysicalFile;

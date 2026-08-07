const fs = require("fs");

function cleanupUploadedFiles(files, context = "") {
  // @param {Array|Object} files
  // @param {string} context
  if (!files) return;

  const fileList = Array.isArray(files) ? files : [files];

  fileList.forEach((file) => {
    try {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        console.log(`[Cleanup${context ? `:${context}` : ""}] Đã xóa file: ${file.path}`);
      }
    } catch (err) {
      console.error(`[Cleanup${context ? `:${context}` : ""}] Không thể xóa file:`, err);
    }
  });
}

module.exports = cleanupUploadedFiles;

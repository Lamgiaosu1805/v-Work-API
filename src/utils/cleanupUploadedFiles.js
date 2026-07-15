const fs = require("fs");

/**
 * Xóa các file đã upload khi có lỗi xảy ra (rollback file rác).
 * Bọc try-catch để lỗi xóa file không làm crash toàn bộ flow xử lý chính.
 * @param {Array|Object} files - có thể là 1 file (req.file) hoặc mảng file (req.files)
 * @param {string} context - nhãn để log biết đang cleanup ở đâu (dễ debug)
 */
function cleanupUploadedFiles(files, context = "") {
  if (!files) return;

  // Chuẩn hóa: luôn xử lý dưới dạng mảng, dù truyền vào 1 file hay nhiều file
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

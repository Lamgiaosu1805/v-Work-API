const path = require("path");
const fs = require("fs");
const DocumentTypeModel = require("../models/DocumentTypeModel");
const { isInsideTicketDir } = require("../middlewares/uploadTicket");

const DocumentController = {
  createTypeDocument: async (req, res) => {
    try {
      const { name, description, required } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Tên loại tài liệu là bắt buộc" });
      }
      const newType = new DocumentTypeModel({
        name,
        description,
        required
      });
      await newType.save();
      return res.status(201).json({
        message: "Tạo loại tài liệu thành công",
        data: newType
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },
  getListDocument: async (req, res) => {
    try {
      const listDocument = await DocumentTypeModel.find({ isDeleted: false });
      res.status(200).json({
        message: "Lấy danh sách document thành công",
        data: listDocument
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },
  getFile: async (req, res) => {
    const { filename } = req.query;
    try {
      if (process.env.NODE_ENV === "production") {
        if (!filename) {
          return res.status(400).json({ message: "Thiếu tham số filename" });
        }

        if (typeof filename !== "string") {
          return res.status(400).json({ message: "Tham số filename không hợp lệ" });
        }

        // Chỉ phục vụ file nằm trong thư mục upload (chặn ../ và đường dẫn tuyệt đối), trừ thư mục file
        // ticket — file ticket chỉ tải qua /tickets (có kiểm quyền xem ticket + file nhạy cảm).
        const baseDir = path.resolve(process.env.UPLOAD_DIR_PROD);
        const isServable = (p) => p.startsWith(baseDir + path.sep) && !isInsideTicketDir(p);

        // path.join (như cũ): "/a.pdf" vẫn hiểu là a.pdf trong thư mục upload; ../ thì bị isServable chặn.
        let filePath = path.join(baseDir, filename);
        if (!isServable(filePath)) {
          return res.status(404).json({ message: "Không tìm thấy file trên server" });
        }

        if (!fs.existsSync(filePath)) {
          // Fallback: bài viết cũ lưu tên không có tiền tố feed/
          const fallback = path.join(baseDir, "feed", path.basename(filename));
          if (isServable(fallback) && fs.existsSync(fallback)) {
            filePath = fallback;
          } else {
            return res.status(404).json({ message: "Không tìm thấy file trên server" });
          }
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentTypeMap = {
          ".pdf": "application/pdf",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
          ".gif": "image/gif"
        };
        const contentType = contentTypeMap[ext] ?? "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `inline; filename="${path.basename(filePath)}"`);

        return res.sendFile(filePath);
      }
      // env = development → luôn gửi file mặc định
      const filePath = path.join(process.cwd(), "uploads", "1762364834517-627301069.pdf");

      console.log("📂 File path:", filePath); // debug thử

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File mặc định không tồn tại" });
      }

      // Set header cho browser hiểu đây là file tải về
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="default.pdf"');

      return res.sendFile(filePath);
    } catch (error) {
      console.error("Lỗi khi lấy file:", error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  }
};

module.exports = DocumentController;

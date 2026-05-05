const path = require("path");
const fs = require("fs");
const DocumentTypeModel = require("../models/DocumentTypeModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDocumentModel = require("../models/UserDocumentModel");

const uploadDir =
  process.env.NODE_ENV === "production"
    ? process.env.UPLOAD_DIR_PROD
    : process.env.UPLOAD_DIR_DEV;
const DocumentController = {
    createTypeDocument: async (req, res) => {
        try {
            const { name, description, required } = req.body;
            if (!name) {
                return res.status(400).json({ message: 'Tên loại tài liệu là bắt buộc' });
            }
            const newType = new DocumentTypeModel({
                name,
                description,
                required: required,
            });
            await newType.save();
            return res.status(201).json({
                message: 'Tạo loại tài liệu thành công',
                data: newType,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Lỗi server', error: error.message });
        }

    },
    getListDocument: async (req, res) => {
        try {
            const listDocument = await DocumentTypeModel.find({ isDeleted: false })
            res.status(200).json({
                message: 'Lấy danh sách document thành công',
                data: listDocument,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Lỗi server', error: error.message });
        }
    },
    getFile: async (req, res) => {
        const { filename } = req.query
        try {
            if (process.env.NODE_ENV === "production") {
                if (!filename) {
                    return res.status(400).json({ message: "Thiếu tham số filename" });
                }

                const filePath = path.join("/var/www/vWork/private", filename);

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ message: "Không tìm thấy file trên server" });
                }

                // Xác định loại file (image, pdf, ...)
                const ext = path.extname(filename).toLowerCase();
                let contentType = "application/octet-stream";

                if (ext === ".pdf") contentType = "application/pdf";
                else if ([".jpg", ".jpeg"].includes(ext)) contentType = "image/jpeg";
                else if (ext === ".png") contentType = "image/png";

                res.setHeader("Content-Type", contentType);
                res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

                return res.sendFile(filePath);
            } else {
                // env = development → luôn gửi file mặc định
                const filePath = path.join(process.cwd(), "uploads", "1762364834517-627301069.pdf");

                console.log("📂 File path:", filePath); // debug thử

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ message: "File mặc định không tồn tại" });
                }

                // Set header cho browser hiểu đây là file tải về
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Disposition", "inline; filename=\"default.pdf\"");

                return res.sendFile(filePath);
            }
        } catch (error) {
            console.error("Lỗi khi lấy file:", error);
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },
};

module.exports = DocumentController;
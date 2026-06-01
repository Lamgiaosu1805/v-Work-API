const path = require("path");
const fs = require("fs");
const DocumentTypeModel = require("../models/DocumentTypeModel");

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

                let filePath = path.join(process.env.UPLOAD_DIR_PROD, filename);

                if (!fs.existsSync(filePath)) {
                    // Fallback: bài viết cũ lưu tên không có tiền tố feed/
                    const fallback = path.join(process.env.UPLOAD_DIR_PROD, 'feed', path.basename(filename));
                    if (fs.existsSync(fallback)) {
                        filePath = fallback;
                    } else {
                        return res.status(404).json({ message: "Không tìm thấy file trên server" });
                    }
                }

                const ext = path.extname(filePath).toLowerCase();
                const contentTypeMap = {
                    ".pdf":  "application/pdf",
                    ".jpg":  "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".png":  "image/png",
                    ".webp": "image/webp",
                    ".gif":  "image/gif",
                };
                const contentType = contentTypeMap[ext] ?? "application/octet-stream";

                res.setHeader("Content-Type", contentType);
                res.setHeader("Content-Disposition", `inline; filename="${path.basename(filePath)}"`);

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
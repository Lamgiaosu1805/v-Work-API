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
        const { filename } = req.query;
        try {
            if (!filename) {
                return res.status(400).json({ message: "Thiếu tham số filename" });
            }

            const filePath = path.resolve(uploadDir, filename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: "Không tìm thấy file trên server" });
            }

            if (req.account.role !== "admin") {
                const userInfo = await UserInfoModel.findOne({ id_account: req.account._id });
                if (!userInfo) {
                    return res.status(404).json({ message: "Không tìm thấy thông tin user" });
                }

                const hasAccess = await UserDocumentModel.exists({
                    "documents.attachments.file_url": { $regex: filename },
                    "documents.attachments.allowed_users": userInfo._id,
                });

                if (!hasAccess) {
                    return res.status(403).json({ message: "Bạn không có quyền xem file này" });
                }
            }

            const ext = path.extname(filename).toLowerCase();
            const contentTypeMap = {
                ".pdf": "application/pdf",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
            };
            const contentType = contentTypeMap[ext] || "application/octet-stream";

            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

            return res.sendFile(filePath);
        } catch (error) {
            console.error("Lỗi khi lấy file:", error);
            return res.status(500).json({ message: "Lỗi server", error: error.message });
        }
    },
};

module.exports = DocumentController;
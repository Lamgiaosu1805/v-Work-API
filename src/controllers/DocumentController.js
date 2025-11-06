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
            const listDocument = await DocumentTypeModel.find({isDeleted: false})
            res.status(200).json({
                message: 'Lấy danh sách document thành công',
                data: listDocument,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Lỗi server', error: error.message });
        }
    }
};

module.exports = DocumentController;
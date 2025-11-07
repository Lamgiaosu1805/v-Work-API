const LaborContractModel = require("../models/LaborContractModel");
const path = require("path");

const LaborContractController = {
    createLaborContract: async (req, res) => {
        try {
            const {
                id_user_info,
                contract_number,
                start_date,
                end_date,
                type,
                note,
                created_by,
            } = req.body;

            // Kiểm tra file có được upload không
            if (!req.file) {
                return res.status(400).json({ message: "Vui lòng tải lên file hợp đồng." });
            }

            // Kiểm tra các trường bắt buộc
            if (!id_user_info || !contract_number || !start_date || !type) {
                return res.status(400).json({ message: "Thiếu thông tin bắt buộc." });
            }

            // Tạo đối tượng mới
            const newContract = new LaborContractModel({
                id_user_info,
                contract_number,
                start_date,
                end_date: end_date || null,
                type,
                note,
                file_url: req.file.path,
                created_by,
            });

            await newContract.save();

            res.status(201).json({
                message: "Tạo hợp đồng lao động thành công.",
                data: newContract,
            });
        } catch (error) {
            console.error("❌ Lỗi tạo hợp đồng:", error);
            res.status(500).json({ message: "Lỗi server.", error: error.message });
        }
    }
}

module.exports = LaborContractController
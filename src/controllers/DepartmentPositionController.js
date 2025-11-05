const DepartmentModel = require("../models/DepartmentModel");
const PositionModel = require("../models/PositionModel");

const DepartmentPositionController = {
    createDepartment: async (req, res) => {
        try {
            const { department_name, department_code, description } = req.body
            if (!department_name, !department_code) {
                return res.status(400).json({ message: 'Tên và mã phòng ban là bắt buộc' });
            }
            const newDepartment = new DepartmentModel({
                department_code,
                department_name,
                description
            })
            await newDepartment.save();
            return res.status(201).json({
                message: 'Tạo phòng ban thành công',
                data: newDepartment,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Lỗi server', error: error.message });
        }
    },
    createPosition: async (req, res) => {
        try {
            const { position_name, description } = req.body
            if (!position_name) {
                return res.status(400).json({ message: 'Tên vị trí là bắt buộc' });
            }
            const newPosition = new PositionModel({
                position_name,
                description
            })
            await newPosition.save();
            return res.status(201).json({
                message: 'Tạo vị trí thành công',
                data: newPosition,
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Lỗi server', error: error.message });
        }
    }
}

module.exports = DepartmentPositionController
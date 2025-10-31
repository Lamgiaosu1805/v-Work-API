const AccountModel = require("../models/AccountModel");


const UserController = {
    createUser: async (req, res) => {
        try {
            const { username, password, email } = req.body;

            if (!username || !password || !email) {
                return res.status(400).json({ message: 'Thiếu dữ liệu cần thiết' });
            }

            const existing = await AccountModel.findOne({ $or: [{ username }, { email }] });
            if (existing) {
                return res.status(400).json({ message: 'Username hoặc email đã tồn tại' });
            }

            const newAccount = await AccountModel.create({ username, password, email });

            res.status(201).json({
                message: 'Tạo tài khoản thành công',
                data: newAccount,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Lỗi server', error: error.message });
        }
    },
    getUserInfo: async (req, res) => {
        try {
            const { userId } = req.params;

            const user = await AccountModel.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'Người dùng không tồn tại' });
            }

            res.status(200).json({
                message: 'Lấy thông tin người dùng thành công',
                data: user,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Lỗi server', error: error.message });
        }
    }
}

module.exports = UserController;
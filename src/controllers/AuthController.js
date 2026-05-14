const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const AccountModel = require("../models/AccountModel");
const redis = require('../config/redis');

const JWT_SECRET = process.env.SECRET_KEY;
const JWT_REFRESH_SECRET = process.env.REFRESH_SECRET_KEY;

const AuthController = {
    // 🔹 Đăng nhập
    login: async (req, res) => {
        try {
            const { username, password } = req.body;

            // 1️⃣ Tìm account
            const account = await AccountModel.findOne({ username });
            if (!account)
                return res.status(400).json({ message: "Sai tên đăng nhập hoặc mật khẩu" });

            // 2️⃣ Kiểm tra tài khoản bị xoá hoặc khoá
            if (account.isDeleted)
                return res.status(403).json({ message: "Tài khoản đã bị khóa hoặc xóa" });

            // 3️⃣ Kiểm tra mật khẩu
            const isMatch = await bcrypt.compare(password, account.password);
            if (!isMatch)
                return res.status(400).json({ message: "Sai tên đăng nhập hoặc mật khẩu" });

            // 4️⃣ Kiểm tra đăng nhập lần đầu
            if (account.isFirstLogin) {
                const tempToken = jwt.sign(
                    { id: account._id, purpose: "password_reset" },
                    JWT_SECRET,
                    { expiresIn: "10m" }
                );
                return res.status(200).json({
                    message: "Đây là lần đầu đăng nhập, vui lòng đổi mật khẩu",
                    isFirstLogin: true,
                    tempToken,
                });
            }

            // 5️⃣ Tạo access token & refresh token
            const accessToken = jwt.sign(
                { id: account._id, username: account.username, role: account.role },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const refreshToken = jwt.sign(
                { id: account._id },
                JWT_REFRESH_SECRET,
                { expiresIn: "10d" }
            );

            // 6️⃣ Lưu refresh token vào DB
            account.refreshTokens.push({
                token: refreshToken,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
            });
            await account.save();

            res.status(200).json({
                message: "Đăng nhập thành công",
                accessToken,
                refreshToken,
                account: {
                    id: account._id,
                    username: account.username,
                    role: account.role,
                    module_access: account.module_access || [],
                    dept_scope: account.dept_scope,
                },
            });
        } catch (err) {
            console.error("Login Error:", err);
            res.status(500).json({ message: "Internal server error", error: err.message });
        }
    },

    // 🔹 Đổi mật khẩu lần đầu
    changeFirstPassword: async (req, res) => {
        try {
            const { newPassword } = req.body;
            const authHeader = req.headers.authorization;

            if (!authHeader)
                return res.status(401).json({ message: "Thiếu token xác thực" });

            const token = authHeader.split(" ")[1];
            const decoded = jwt.verify(token, JWT_SECRET);

            if (decoded.purpose !== "password_reset")
                return res.status(400).json({ message: "Token không hợp lệ cho đổi mật khẩu" });

            const account = await AccountModel.findById(decoded.id);
            if (!account)
                return res.status(404).json({ message: "Không tìm thấy tài khoản" });

            const hashed = await bcrypt.hash(newPassword, 10);
            account.password = hashed;
            account.isFirstLogin = false;
            await account.save();

            res.status(200).json({ message: "Đổi mật khẩu thành công, vui lòng đăng nhập lại" });
        } catch (err) {
            console.error("Change Password Error:", err);
            res.status(500).json({ message: "Internal server error", error: err.message });
        }
    },

    refreshToken: async (req, res) => {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken)
                return res.status(400).json({ message: "Thiếu refresh token" });

            // 1️⃣ Verify refresh token
            let decoded;
            try {
                decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
            } catch (err) {
                return res.status(401).json({ message: "Refresh token không hợp lệ hoặc hết hạn" });
            }

            // 2️⃣ Kiểm tra token có tồn tại trong DB không
            const account = await AccountModel.findOne({
                _id: decoded.id,
                "refreshTokens.token": refreshToken,
                "refreshTokens.revoked": false
            });

            if (!account)
                return res.status(403).json({ message: "Refresh token không hợp lệ hoặc đã bị thu hồi" });

            // 3️⃣ Thu hồi token cũ (chỉ update revoked)
            await AccountModel.updateOne(
                {
                    _id: decoded.id,
                    "refreshTokens.token": refreshToken
                },
                {
                    $set: { "refreshTokens.$.revoked": true }
                }
            );

            // 4️⃣ Tạo token mới
            const newAccessToken = jwt.sign(
                { id: decoded.id },
                JWT_SECRET,
                { expiresIn: "30m" }
            );

            const newRefreshToken = jwt.sign(
                { id: decoded.id },
                JWT_REFRESH_SECRET,
                { expiresIn: "3d" }
            );

            // 5️⃣ Thêm refresh token mới vào danh sách (tách riêng để tránh conflict)
            await AccountModel.updateOne(
                { _id: decoded.id },
                {
                    $push: {
                        refreshTokens: {
                            token: newRefreshToken,
                            createdAt: new Date(),
                            expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                            revoked: false
                        }
                    }
                }
            );

            // 6️⃣ Trả về token mới
            res.status(200).json({
                message: "Làm mới token thành công",
                accessToken: newAccessToken,
                refreshToken: newRefreshToken
            });

        } catch (err) {
            console.error("Refresh Token Error:", err);
            res.status(500).json({ message: "Lỗi hệ thống", error: err.message });
        }
    },
    
    changePassword: async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;
            const accountId = req.account._id;

        if (!currentPassword || !newPassword)
            return res.status(400).json({ message: "Thiếu currentPassword hoặc newPassword" });

        const account = await AccountModel.findById(accountId);
        if (!account || account.isDeleted)
            return res.status(404).json({ message: "Không tìm thấy tài khoản" });

        const isMatch = await bcrypt.compare(currentPassword, account.password);
        if (!isMatch)
            return res.status(400).json({ message: "Mật khẩu hiện tại không đúng" });

        const isSame = await bcrypt.compare(newPassword, account.password);
        if (isSame)
            return res.status(400).json({ message: "Mật khẩu mới không được trùng mật khẩu cũ" });

        account.password = await bcrypt.hash(newPassword, 10);
        account.refreshTokens = [];
        // Blacklist access token hiện tại
        const authHeader = req.headers.authorization;
        const currentToken = authHeader.split(' ')[1];
        const decoded = jwt.decode(currentToken);
        const ttl = decoded.exp - Math.floor(Date.now() / 1000); // số giây còn lại
        if (ttl > 0) {
            await redis.set(`blacklist:${currentToken}`, '1', 'EX', ttl);
        }
        await account.save();

        res.status(200).json({ message: "Đổi mật khẩu thành công, vui lòng đăng nhập lại" });
        } catch (err) {
        console.error("Change Password Error:", err);
        res.status(500).json({ message: "Internal server error", error: err.message });
        }
    },

    resetPassword: async (req, res) => {
        try {
            const { accountId, newPassword } = req.body;

            if (!accountId || !newPassword)
                return res.status(400).json({ message: "Thiếu accountId hoặc newPassword" });

            const account = await AccountModel.findById(accountId);
            if (!account || account.isDeleted)
                return res.status(404).json({ message: "Không tìm thấy tài khoản" });

            const salt = await bcrypt.genSalt(10);
            account.password = await bcrypt.hash(newPassword, salt);
            account.isFirstLogin = true;
            account.refreshTokens = [];
            await account.save();

            res.status(200).json({ message: "Reset mật khẩu thành công" });
        } catch (err) {
            console.error("Reset Password Error:", err);
            res.status(500).json({ message: "Internal server error", error: err.message });
        }
    },

    logout: async (req, res) => {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken)
                return res.status(400).json({ message: "Thiếu refresh token" });

            // Tìm account có chứa refreshToken này (không cần verify)
            const account = await AccountModel.findOne({
                "refreshTokens.token": refreshToken,
            });

            if (!account)
                return res.status(404).json({ message: "Không tìm thấy tài khoản hoặc token" });

            // Revoke token
            const tokenEntry = account.refreshTokens.find(
                (t) => t.token === refreshToken
            );

            if (tokenEntry) {
                tokenEntry.revoked = true;
                await account.save();
                return res.status(200).json({ message: "Đăng xuất thành công" });
            }

            res.status(400).json({ message: "Refresh token không tồn tại" });
        } catch (err) {
            console.error("Logout Error:", err);
            res.status(500).json({
                message: "Lỗi hệ thống",
                error: err.message,
            });
        }
    },

    setPermission: async (req, res) => {
        try {
            const { accountId } = req.params;
            const { role, module_access, dept_scope } = req.body;

            const account = await AccountModel.findById(accountId);
            if (!account || account.isDeleted)
                return res.status(404).json({ message: "Không tìm thấy tài khoản" });

            if (role !== undefined) {
                if (!["admin", "manager", "user"].includes(role))
                    return res.status(400).json({ message: "role không hợp lệ" });
                account.role = role;
            }

            if (module_access !== undefined) {
                const valid = ["hrm", "workplace", "crm"];
                if (!Array.isArray(module_access) || module_access.some((m) => !valid.includes(m)))
                    return res.status(400).json({ message: "module_access không hợp lệ" });
                account.module_access = module_access;
            }

            if (dept_scope !== undefined) {
                if (!["all", "own"].includes(dept_scope))
                    return res.status(400).json({ message: "dept_scope không hợp lệ" });
                account.dept_scope = dept_scope;
            }

            await account.save();

            return res.status(200).json({
                message: "Cập nhật quyền thành công",
                data: {
                    _id: account._id,
                    username: account.username,
                    role: account.role,
                    module_access: account.module_access,
                    dept_scope: account.dept_scope,
                },
            });
        } catch (err) {
            return res.status(500).json({ message: "Lỗi server", error: err.message });
        }
    },

};

module.exports = AuthController;

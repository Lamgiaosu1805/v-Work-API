const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AccountModel = require("../models/AccountModel");

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        errorCode: "MISSING_TOKEN",
        message: "Không có access token",
      });
    }

    const token = authHeader.split(" ")[1]; // "Bearer <token>"

    // ✅ Verify token
    const decoded = jwt.verify(token, process.env.SECRET_KEY);

    // ✅ Kiểm tra user có tồn tại
    const account = await AccountModel.findById(decoded.id);
    if (!account) {
      return res.status(401).json({
        errorCode: "USER_NOT_FOUND",
        message: "Không tìm thấy tài khoản",
      });
    }

    // ✅ Kiểm tra tài khoản bị xóa hoặc khóa
    if (account.isDeleted) {
      return res.status(403).json({
        errorCode: "ACCOUNT_LOCKED",
        message: "Tài khoản đã bị khóa hoặc xóa",
      });
    }

    // ✅ Gắn user vào request
    req.account = {
      _id: account._id,
      username: account.username,
      role: account.role,
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        errorCode: "TOKEN_EXPIRED",
        message: "Access token đã hết hạn",
      });
    }

    return res.status(401).json({
      errorCode: "INVALID_TOKEN",
      message: "Token không hợp lệ",
    });
  }
}

function isAdmin(req, res, next) {
  if (req.account?.role === "admin") return next();
  return res.status(403).json({
    errorCode: "FORBIDDEN",
    message: "Chỉ admin mới được phép thực hiện thao tác này",
  });
}

module.exports = {
  authenticate,
  isAdmin,
};

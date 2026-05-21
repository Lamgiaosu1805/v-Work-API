const jwt = require("jsonwebtoken");
const AccountModel = require("../models/AccountModel");
const redis = require("../config/redis");

const ACCOUNT_CACHE_TTL = 60; // seconds

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ errorCode: "MISSING_TOKEN", message: "Không có access token" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.SECRET_KEY);

    // Thử lấy từ Redis trước — tránh DB query mỗi request
    const cacheKey = `auth:account:${decoded.id}`;
    let accountData = null;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) accountData = JSON.parse(cached);
    } catch { /* Redis không khả dụng → fall through */ }

    if (!accountData) {
      const account = await AccountModel.findById(decoded.id).lean();
      if (!account) {
        return res.status(401).json({ errorCode: "USER_NOT_FOUND", message: "Không tìm thấy tài khoản" });
      }
      if (account.isDeleted) {
        return res.status(403).json({ errorCode: "ACCOUNT_LOCKED", message: "Tài khoản đã bị khóa hoặc xóa" });
      }
      accountData = {
        _id: String(account._id),
        username: account.username,
        role: account.role,
        module_access: account.module_access || [],
        dept_scope: account.dept_scope,
        isDeleted: account.isDeleted,
      };
      try { await redis.setex(cacheKey, ACCOUNT_CACHE_TTL, JSON.stringify(accountData)); } catch { /* ignore */ }
    } else if (accountData.isDeleted) {
      return res.status(403).json({ errorCode: "ACCOUNT_LOCKED", message: "Tài khoản đã bị khóa hoặc xóa" });
    }

    req.account = {
      _id: accountData._id,
      username: accountData.username,
      role: accountData.role,
      module_access: accountData.module_access,
      dept_scope: accountData.dept_scope,
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ errorCode: "TOKEN_EXPIRED", message: "Access token đã hết hạn" });
    }
    return res.status(401).json({ errorCode: "INVALID_TOKEN", message: "Token không hợp lệ" });
  }
}

function isAdmin(req, res, next) {
  if (req.account?.role === "admin") return next();
  return res.status(403).json({ errorCode: "FORBIDDEN", message: "Chỉ admin mới được phép thực hiện thao tác này" });
}

// Xem/truy cập module — user hoặc manager có module trong module_access
function hasModuleAccess(mod) {
  return (req, res, next) => {
    if (req.account?.role === "admin") return next();
    if (req.account?.module_access?.includes(mod)) return next();
    return res.status(403).json({ errorCode: "FORBIDDEN", message: "Bạn không có quyền truy cập tính năng này" });
  };
}

// Quản lý trong module — phải là manager + có module trong module_access
function canManage(mod) {
  return (req, res, next) => {
    if (req.account?.role === "admin") return next();
    if (req.account?.role === "manager" && req.account?.module_access?.includes(mod)) return next();
    return res.status(403).json({ errorCode: "FORBIDDEN", message: "Bạn không có quyền quản lý tính năng này" });
  };
}

module.exports = {
  authenticate,
  isAdmin,
  hasModuleAccess,
  canManage,
};

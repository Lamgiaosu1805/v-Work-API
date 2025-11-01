// const jwt = require("jsonwebtoken");
// const Account = require("../models/AccountModel");
// const UserInfo = require("../models/UserInfoModel");

// // Middleware xác thực token và gán req.user
// async function authenticate(req, res, next) {
//   try {
//     const authHeader = req.headers.authorization;
//     if (!authHeader) return res.status(401).json({ message: "No token" });

//     const token = authHeader.split(" ")[1]; // Bearer <token>
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     const user = await Account.findById(decoded.userId);
//     if (!user) return res.status(401).json({ message: "User not found" });

//     req.user = {
//       _id: user._id,
//       role: user.role, // "admin" hoặc "user"
//     };
//     next();
//   } catch (err) {
//     res.status(401).json({ message: "Invalid token" });
//   }
// }

// // Kiểm tra admin
// function isAdmin(req, res, next) {
//   if (req.user.role === "admin") return next();
//   return res.status(403).json({ message: "Chỉ admin mới được phép" });
// }

// // Kiểm tra chính chủ hoặc admin dựa trên UserInfo.id_account
// async function isOwnerOrAdmin(req, res, next) {
//   try {
//     const userInfoId = req.params.userInfoId || req.body.user_info_id;
//     if (!userInfoId) return res.status(400).json({ message: "userInfoId không được để trống" });

//     const userInfo = await UserInfo.findById(userInfoId);
//     if (!userInfo) return res.status(404).json({ message: "UserInfo không tồn tại" });

//     // Nếu admin hoặc chính chủ
//     if (req.user.role === "admin" || userInfo.id_account.toString() === req.user._id.toString()) {
//       return next();
//     }

//     return res.status(403).json({ message: "Bạn không có quyền truy cập hồ sơ này" });
//   } catch (err) {
//     return res.status(500).json({ message: err.message });
//   }
// }

// module.exports = { authenticate, isAdmin, isOwnerOrAdmin };
const { default: mongoose } = require("mongoose");
const Account = require("../models/AccountModel");
const UserInfo = require("../models/UserInfoModel");

async function mockAdmin(req, res, next) {
  // Mock admin test
  req.user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
  next();
}

async function isAdmin(req, res, next) {
  if (req.user.role === "admin") return next();
  return res.status(403).json({ message: "Chỉ admin mới được phép" });
}

async function isOwnerOrAdmin(req, res, next) {
  const userDocument = req.userDocument; // attach trước đó
  if (!userDocument) return res.status(400).json({ message: "Document not found" });

  if (
    req.user.role === "admin" ||
    userDocument.user_id.toString() === req.user._id.toString()
  )
    return next();

  return res.status(403).json({ message: "Không có quyền truy cập" });
}

module.exports = { mockAdmin, isAdmin, isOwnerOrAdmin };


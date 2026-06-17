const jwt = require("jsonwebtoken");
const AccountModel = require("../models/AccountModel");
const UserInfoModel = require("../models/UserInfoModel");

function getSocketToken(socket) {
  return (
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(" ")[1] ||
    socket.handshake.query?.token
  );
}

async function resolveSocketUser(socket) {
  const token = getSocketToken(socket);
  if (!token) return null;

  const decoded = jwt.verify(token, process.env.SECRET_KEY);
  const account = await AccountModel.findById(decoded.id).lean();
  if (!account || account.isDeleted) return null;

  const userInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false })
    .select("full_name avatar ma_nv id_account")
    .lean();
  if (!userInfo) return null;

  return { accountId: String(account._id), userInfo };
}

module.exports = { getSocketToken, resolveSocketUser };

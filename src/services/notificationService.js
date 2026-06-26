const mongoose = require("mongoose");
const NotificationModel = require("../models/NotificationModel");
const pushNotification = require("../helpers/pushNotification");
const { getIO } = require("../sockets/ioRegistry");

function emitToAccount(accountId, notification) {
  const io = getIO();
  if (!io || !accountId) return;
  io.to(`account:${String(accountId)}`).emit("notification:new", { notification });
}

function withIsRead(notification, accountId) {
  const readBy = (notification.read_by || []).map((id) => String(id));
  return { ...notification, is_read: readBy.includes(String(accountId)) };
}

async function createNotification({
  account_id,
  title,
  body = "",
  type,
  ref_id = null,
  ref_type = null,
  uri = null,
  push = true,
  data = {}
}) {
  if (!account_id || !title || !type) return null;

  const notification = await NotificationModel.create({
    target: "individual",
    account_id,
    title,
    body,
    type,
    ref_id,
    ref_type,
    uri
  });

  emitToAccount(account_id, notification.toJSON());

  if (push) {
    pushNotification
      .sendToAccount({
        account_id,
        title,
        body,
        data: { type, uri: uri || "", ...data }
      })
      .catch(() => {});
  }

  return notification;
}

async function listNotifications({ accountId, page = 1, limit = 20 }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const filter = {
    isDeleted: false,
    $or: [{ account_id: accountId }, { target: "broadcast" }]
  };

  const [items, total] = await Promise.all([
    NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    NotificationModel.countDocuments(filter)
  ]);

  return {
    data: items.map((n) => withIsRead(n, accountId)),
    page: safePage,
    limit: safeLimit,
    total,
    hasMore: skip + items.length < total
  };
}

async function countUnread(accountId) {
  return NotificationModel.countDocuments({
    isDeleted: false,
    read_by: { $ne: accountId },
    $or: [{ account_id: accountId }, { target: "broadcast" }]
  });
}

async function markRead({ accountId, notificationId }) {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) return null;

  return NotificationModel.findOneAndUpdate(
    {
      _id: notificationId,
      isDeleted: false,
      $or: [{ account_id: accountId }, { target: "broadcast" }]
    },
    { $addToSet: { read_by: accountId } },
    { new: true }
  ).lean();
}

async function markAllRead(accountId) {
  const result = await NotificationModel.updateMany(
    {
      isDeleted: false,
      read_by: { $ne: accountId },
      $or: [{ account_id: accountId }, { target: "broadcast" }]
    },
    { $addToSet: { read_by: accountId } }
  );

  return { modifiedCount: result.modifiedCount ?? 0 };
}

module.exports = {
  createNotification,
  listNotifications,
  countUnread,
  markRead,
  markAllRead
};

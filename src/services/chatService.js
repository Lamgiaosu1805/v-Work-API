const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const ConversationModel = require("../models/ConversationModel");
const MessageModel = require("../models/MessageModel");
const UserInfoModel = require("../models/UserInfoModel");
const AccountModel = require("../models/AccountModel");
const { ChatError } = require("../helpers/socketHandler");

function removeAttachmentFiles(attachment) {
  if (!attachment) return;

  const baseDir =
    process.env.NODE_ENV === "production"
      ? process.env.UPLOAD_DIR_PROD
      : process.env.UPLOAD_DIR_DEV;

  [attachment.url, attachment.thumbnailUrl].filter(Boolean).forEach((relativePath) => {
    try {
      const filePath = path.resolve(baseDir, relativePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.error("removeAttachmentFiles error:", error?.message || error);
    }
  });
}

function normalizeObjectIds(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function toPlainObject(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject();
  return doc;
}

function formatConversation(conversation, currentUserInfoId) {
  const plainConversation = toPlainObject(conversation);
  if (!plainConversation) return null;
  const members = plainConversation.members || [];
  const myId = String(currentUserInfoId);

  if (plainConversation.type === "group") {
    return {
      ...plainConversation,
      display_name: plainConversation.name || "Nhóm chat",
      avatar: plainConversation.avatar || null
    };
  }

  const otherMember = members.find((member) => String(member?._id || member) !== myId) || null;

  return {
    ...plainConversation,
    display_name: otherMember?.full_name || plainConversation.name || "Tin nhắn",
    avatar: otherMember?.avatar ?? plainConversation.avatar ?? null
  };
}

async function getCurrentUserInfo(accountId) {
  const userInfo = await UserInfoModel.findOne({
    id_account: accountId,
    isDeleted: false
  })
    .select("full_name avatar ma_nv id_account")
    .lean();

  if (userInfo) return userInfo;

  const account = await AccountModel.findById(accountId).select("_id username").lean();
  if (!account) throw new ChatError("Không tìm thấy thông tin người dùng", 404);

  return {
    _id: account._id,
    full_name: account.username,
    avatar: null,
    ma_nv: null,
    id_account: account._id
  };
}

async function loadConversationById(conversationId, currentUserInfoId, session) {
  const query = ConversationModel.findOne({
    _id: conversationId,
    members: currentUserInfoId,
    isDeleted: false
  });

  if (session) {
    query.session(session);
  }

  const conversation = await query
    .populate("members", "full_name avatar ma_nv id_account")
    .populate("admins", "full_name avatar ma_nv id_account")
    .populate("createdBy", "full_name avatar ma_nv id_account")
    .populate({
      path: "lastMessage",
      match: { isDeleted: false },
      populate: {
        path: "senderId",
        select: "full_name avatar ma_nv id_account"
      }
    })
    .lean();

  if (!conversation) {
    throw new ChatError("Conversation không tồn tại hoặc bạn không có quyền truy cập", 404);
  }

  return formatConversation(conversation, currentUserInfoId);
}

async function ensureConversationAccess(conversationId, userInfoId) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    members: userInfoId,
    isDeleted: false
  }).lean();

  if (!conversation) {
    throw new ChatError("Conversation không tồn tại hoặc bạn không có quyền truy cập", 404);
  }

  return conversation;
}

async function createPrivateConversation({ currentUserInfoId, receiverUserInfoId }) {
  const receiverId = String(receiverUserInfoId || "").trim();
  if (!receiverId) {
    throw new ChatError("Thiếu receiver_id", 400);
  }

  const senderId = String(currentUserInfoId);
  if (senderId === receiverId) {
    throw new ChatError("Không thể chat với chính mình", 400);
  }

  let receiver = await UserInfoModel.findOne({
    _id: receiverId,
    isDeleted: false
  })
    .select("full_name avatar ma_nv id_account")
    .lean();

  if (!receiver) {
    receiver = await UserInfoModel.findOne({
      id_account: receiverId,
      isDeleted: false
    })
      .select("full_name avatar ma_nv id_account")
      .lean();
  }

  if (!receiver) {
    throw new ChatError("Người dùng không tồn tại", 404);
  }

  const pairKey = [String(currentUserInfoId), String(receiver._id)].sort().join("_");

  const existingConversation = await ConversationModel.findOne({
    pairKey,
    isDeleted: false
  });

  if (existingConversation) {
    if (!existingConversation.pairKey) {
      await ConversationModel.updateOne({ _id: existingConversation._id }, { $set: { pairKey } });
    }
    return loadConversationById(existingConversation._id, currentUserInfoId);
  }

  try {
    await ConversationModel.updateOne(
      { pairKey },
      {
        $setOnInsert: {
          type: "private",
          members: [currentUserInfoId, receiver._id],
          createdBy: currentUserInfoId
        }
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const conversation = await ConversationModel.findOne({ pairKey });
  return loadConversationById(conversation._id, currentUserInfoId);
}

async function createMessageDocument({
  conversationId,
  senderUserInfoId,
  content,
  type = "text",
  attachment = null,
  seenBy = [],
  session
}) {
  const payload = {
    conversationId,
    senderId: senderUserInfoId,
    type,
    content: content || "",
    seenBy
  };

  if (attachment) {
    payload.attachment = attachment;
  }

  const createdMessages = session
    ? await MessageModel.create([payload], { session })
    : await MessageModel.create([payload]);

  return Array.isArray(createdMessages) ? createdMessages[0] : createdMessages;
}

async function createGroupConversation({ name, memberIds, creatorUserInfoId, session }) {
  const groupName = String(name || "").trim();
  if (!groupName) {
    throw new ChatError("Thiếu name", 400);
  }

  const candidateIds = normalizeObjectIds(memberIds || []);
  const withCreator = normalizeObjectIds([...candidateIds, creatorUserInfoId]);
  if (withCreator.length < 2) {
    throw new ChatError("Group phải có ít nhất 2 thành viên", 400);
  }

  const users = await UserInfoModel.find({
    isDeleted: false,
    $or: [{ _id: { $in: withCreator } }, { id_account: { $in: withCreator } }]
  })
    .select("full_name avatar ma_nv id_account")
    .lean();

  if (users.length !== withCreator.length) {
    throw new ChatError("Có user không tồn tại", 404);
  }

  const resolvedMemberIds = users.map((u) => String(u._id));

  const createdConversation = await ConversationModel.create(
    [
      {
        type: "group",
        name: groupName,
        members: resolvedMemberIds,
        admins: [creatorUserInfoId],
        createdBy: creatorUserInfoId
      }
    ],
    { session }
  );

  const conversation = Array.isArray(createdConversation)
    ? createdConversation[0]
    : createdConversation;

  const systemMessage = await createMessageDocument({
    conversationId: conversation._id,
    senderUserInfoId: creatorUserInfoId,
    content: "Nhóm đã được tạo",
    type: "system",
    seenBy: [creatorUserInfoId],
    session
  });

  await ConversationModel.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessage: systemMessage._id,
        updatedAt: new Date()
      }
    },
    { session }
  );
  return loadConversationById(conversation._id, creatorUserInfoId, session);
}

async function updateGroupConversationName({ conversationId, userInfoId, name }) {
  const groupName = String(name || "").trim();
  if (!groupName) {
    throw new ChatError("Thiếu name", 400);
  }

  const exists = await ConversationModel.exists({
    _id: conversationId,
    members: userInfoId,
    type: "group",
    isDeleted: false
  });

  if (!exists) {
    throw new ChatError("Conversation không tồn tại hoặc bạn không có quyền truy cập", 404);
  }

  await ConversationModel.updateOne(
    { _id: conversationId },
    {
      $set: {
        name: groupName,
        updatedAt: new Date()
      }
    }
  );

  return loadConversationById(conversationId, userInfoId);
}

async function updateGroupConversationAvatar({ conversationId, userInfoId, imgPath }) {
  if (!imgPath) {
    throw new ChatError("Thiếu imgPath", 400);
  }

  const exists = await ConversationModel.exists({
    _id: conversationId,
    members: userInfoId,
    type: "group",
    isDeleted: false
  });

  if (!exists) {
    throw new ChatError("Conversation không tồn tại hoặc bạn không có quyền truy cập", 404);
  }

  await ConversationModel.updateOne(
    { _id: conversationId },
    {
      $set: {
        avatar: imgPath,
        updatedAt: new Date()
      }
    }
  );

  return loadConversationById(conversationId, userInfoId);
}

async function listConversations(userInfoId, search = "") {
  const conversations = await ConversationModel.find({
    members: userInfoId,
    isDeleted: false,
    deletedFor: { $ne: userInfoId }
  })
    .populate("members", "full_name avatar ma_nv id_account")
    .populate("admins", "full_name avatar ma_nv id_account")
    .populate("createdBy", "full_name avatar ma_nv id_account")
    .populate({
      path: "lastMessage",
      match: { isDeleted: false },
      populate: {
        path: "senderId",
        select: "full_name avatar ma_nv id_account"
      }
    })
    .sort({ updatedAt: -1 })
    .lean();

  const keyword = String(search || "")
    .trim()
    .toLowerCase();

  const formattedConversations = conversations.map((conversation) =>
    formatConversation(conversation, userInfoId)
  );

  if (!keyword) {
    return formattedConversations;
  }

  return formattedConversations.filter((conversation) => {
    const memberNames = (conversation.members || [])
      .map((member) => String(member?.full_name || "").toLowerCase())
      .join(" ");

    const lastMessageContent = String(conversation.lastMessage?.content || "").toLowerCase();
    const displayName = String(conversation.display_name || "").toLowerCase();
    const groupName = String(conversation.name || "").toLowerCase();

    return (
      displayName.includes(keyword) ||
      groupName.includes(keyword) ||
      memberNames.includes(keyword) ||
      lastMessageContent.includes(keyword)
    );
  });
}

async function getConversationDetail({ conversationId, userInfoId }) {
  return loadConversationById(conversationId, userInfoId);
}

async function getConversationMessages({ conversationId, userInfoId, page = 1, limit = 30 }) {
  await ensureConversationAccess(conversationId, userInfoId);

  const filter = {
    conversationId,
    isDeleted: false,
    deletedFor: { $ne: userInfoId }
  };

  const total = await MessageModel.countDocuments(filter);
  const messages = await MessageModel.find(filter)
    .populate("senderId", "full_name avatar ma_nv id_account")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  messages.reverse();

  return {
    data: messages,
    pagination: {
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit)
    }
  };
}

async function sendMessage({
  conversationId,
  senderUserInfoId,
  content,
  type = "text",
  attachment = null,
  session
}) {
  if (!session) {
    throw new ChatError("sendMessage phải chạy trong transaction (thiếu session)", 500);
  }
  await ensureConversationAccess(conversationId, senderUserInfoId);

  const allowedTypes = ["text", "image", "audio"];
  if (!allowedTypes.includes(type)) {
    throw new ChatError("Loại tin nhắn không hợp lệ", 400);
  }

  const normalizedContent = String(content || "").trim();
  if (type === "text" && !normalizedContent) {
    throw new ChatError("Nội dung tin nhắn không được để trống", 400);
  }

  if (type === "image" && !attachment) {
    throw new ChatError("Thiếu file ảnh", 400);
  }

  const message = await createMessageDocument({
    conversationId,
    senderUserInfoId,
    content: normalizedContent,
    type,
    attachment,
    seenBy: [senderUserInfoId],
    session
  });

  await ConversationModel.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessage: message._id,
        updatedAt: new Date(),
        deletedFor: []
      }
    },
    { session }
  );

  const query = MessageModel.findById(message._id).populate(
    "senderId",
    "full_name avatar ma_nv id_account"
  );
  if (session) {
    query.session(session);
  }

  return query.lean();
}

async function markConversationSeen({ conversationId, userInfoId }) {
  await ensureConversationAccess(conversationId, userInfoId);

  const result = await MessageModel.updateMany(
    {
      conversationId,
      senderId: { $ne: userInfoId },
      seenBy: { $ne: userInfoId },
      isDeleted: false
    },
    {
      $addToSet: {
        seenBy: userInfoId
      }
    }
  );

  return {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0
  };
}

async function deleteConversation({ conversationId, userInfoId }) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    members: userInfoId,
    isDeleted: false
  });

  if (!conversation) {
    throw new ChatError("Conversation không tồn tại hoặc bạn không có quyền truy cập", 404);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await ConversationModel.updateOne(
      { _id: conversationId },
      { $addToSet: { deletedFor: userInfoId } },
      { session }
    );
    await MessageModel.updateMany(
      { conversationId, isDeleted: false },
      { $addToSet: { deletedFor: userInfoId } },
      { session }
    );
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  return { conversationId: String(conversationId) };
}

async function recallMessage({ conversationId, messageId, userInfoId }) {
  await ensureConversationAccess(conversationId, userInfoId);

  const message = await MessageModel.findOne({
    _id: messageId,
    conversationId,
    isDeleted: false,
    "recalled.at": null
  });

  if (!message) {
    throw new ChatError("Tin nhắn không tồn tại hoặc đã bị thu hồi", 404);
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (message.createdAt < oneDayAgo) {
    throw new ChatError("Chỉ có thể thu hồi tin nhắn trong vòng 24 giờ", 400);
  }

  if (String(message.senderId) !== String(userInfoId)) {
    throw new ChatError("Bạn không có quyền thu hồi tin nhắn này", 403);
  }

  const recalled = await MessageModel.findByIdAndUpdate(
    messageId,
    {
      $set: { recalled: { at: new Date(), by: userInfoId }, content: "" },
      $unset: { attachment: "" }
    },
    { new: true }
  ).populate("senderId", "full_name avatar ma_nv id_account");

  if (message.type === "image") {
    setImmediate(() => removeAttachmentFiles(message.attachment));
  }

  return recalled;
}

async function deleteMessageForSelf({ conversationId, messageId, userInfoId }) {
  await ensureConversationAccess(conversationId, userInfoId);

  const message = await MessageModel.findOne({
    _id: messageId,
    conversationId,
    isDeleted: false,
    deletedFor: { $ne: userInfoId }
  });

  if (!message) {
    throw new ChatError("Tin nhắn không tồn tại", 404);
  }

  await MessageModel.updateOne({ _id: messageId }, { $addToSet: { deletedFor: userInfoId } });

  return {
    conversationId: String(conversationId),
    messageId: String(messageId)
  };
}

async function addMembers({ conversationId, userInfoId, newMemberIds }) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    type: "group",
    members: userInfoId,
    isDeleted: false
  });
  if (!conversation) throw new ChatError("Không tìm thấy nhóm", 404);

  const normalizedIds = normalizeObjectIds(newMemberIds || []);
  if (!normalizedIds.length) throw new ChatError("Danh sách thành viên không được rỗng", 400);

  const existingIds = new Set(conversation.members.map(String));
  const toAdd = normalizedIds.filter((id) => !existingIds.has(String(id)));
  if (!toAdd.length) throw new ChatError("Tất cả thành viên đã có trong nhóm", 400);

  const found = await UserInfoModel.find({ _id: { $in: toAdd }, isDeleted: false })
    .select("_id")
    .lean();
  if (found.length !== toAdd.length) throw new ChatError("Một số thành viên không tồn tại", 404);

  await ConversationModel.updateOne(
    { _id: conversationId },
    { $addToSet: { members: { $each: toAdd } } }
  );

  return loadConversationById(conversationId, userInfoId);
}

async function kickMember({ conversationId, adminUserInfoId, targetUserInfoId }) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    type: "group",
    members: adminUserInfoId,
    isDeleted: false
  });
  if (!conversation) throw new ChatError("Không tìm thấy nhóm", 404);

  const isAdmin = conversation.admins.some((a) => String(a) === String(adminUserInfoId));
  if (!isAdmin) throw new ChatError("Bạn không có quyền xóa thành viên", 403);

  if (String(targetUserInfoId) === String(adminUserInfoId))
    throw new ChatError("Hãy dùng chức năng rời nhóm để tự xóa bản thân", 400);

  const isMember = conversation.members.some((m) => String(m) === String(targetUserInfoId));
  if (!isMember) throw new ChatError("Thành viên không tồn tại trong nhóm", 404);

  await ConversationModel.updateOne(
    { _id: conversationId },
    { $pull: { members: targetUserInfoId, admins: targetUserInfoId } }
  );

  return loadConversationById(conversationId, adminUserInfoId);
}

async function promoteMember({ conversationId, adminUserInfoId, targetUserInfoId }) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    type: "group",
    members: adminUserInfoId,
    isDeleted: false
  });
  if (!conversation) throw new ChatError("Không tìm thấy nhóm", 404);

  const isAdmin = conversation.admins.some((a) => String(a) === String(adminUserInfoId));
  if (!isAdmin) throw new ChatError("Bạn không có quyền thăng chức thành viên", 403);

  const isMember = conversation.members.some((m) => String(m) === String(targetUserInfoId));
  if (!isMember) throw new ChatError("Thành viên không tồn tại trong nhóm", 404);

  await ConversationModel.updateOne(
    { _id: conversationId },
    { $addToSet: { admins: targetUserInfoId } }
  );

  return loadConversationById(conversationId, adminUserInfoId);
}

async function leaveGroup({ conversationId, userInfoId }) {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    type: "group",
    members: userInfoId,
    isDeleted: false
  });
  if (!conversation) throw new ChatError("Không tìm thấy nhóm hoặc bạn không phải thành viên", 404);

  const remainingMembers = conversation.members.map(String).filter((m) => m !== String(userInfoId));

  if (remainingMembers.length === 0) {
    await ConversationModel.updateOne({ _id: conversationId }, { isDeleted: true });
    return { conversationId: String(conversationId), disbanded: true, conversation: null };
  }

  await ConversationModel.updateOne(
    { _id: conversationId },
    { $pull: { members: userInfoId, admins: userInfoId } }
  );

  const updated = await ConversationModel.findOne({ _id: conversationId })
    .select("admins members")
    .lean();

  if (updated.admins.length === 0 && updated.members.length > 0) {
    const newAdmin = updated.members[0];
    await ConversationModel.updateOne(
      { _id: conversationId, admins: { $size: 0 } },
      { $addToSet: { admins: newAdmin } }
    );
  }

  const updatedConv = await loadConversationById(
    conversationId,
    updated.members[0] ?? remainingMembers[0]
  );
  return { conversationId: String(conversationId), disbanded: false, conversation: updatedConv };
}

module.exports = {
  getCurrentUserInfo,
  createPrivateConversation,
  createGroupConversation,
  listConversations,
  getConversationDetail,
  getConversationMessages,
  sendMessage,
  markConversationSeen,
  deleteConversation,
  recallMessage,
  deleteMessageForSelf,
  updateGroupConversationName,
  addMembers,
  kickMember,
  promoteMember,
  leaveGroup,
  ensureConversationAccess,
  createMessageDocument,
  formatConversation,
  updateGroupConversationAvatar
};

const mongoose = require("mongoose");
const ConversationModel = require("../models/ConversationModel");
const MessageModel = require("../models/MessageModel");
const UserInfoModel = require("../models/UserInfoModel");

class ChatError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ChatError";
    this.statusCode = statusCode;
  }
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

  // Group chat thì hiển thị tên/ảnh của chính group.
  if (plainConversation.type === "group") {
    return {
      ...plainConversation,
      display_name: plainConversation.name || "Nhóm chat",
      avatar: plainConversation.avatar || null
    };
  }

  // Private chat thì hiển thị tên/ảnh của người còn lại trong conversation.
  const otherMember = members.find((member) => String(member?._id || member) !== myId) || null;

  return {
    ...plainConversation,
    display_name: otherMember?.full_name || plainConversation.name || "Tin nhắn",
    avatar: otherMember?.avatar ?? plainConversation.avatar ?? null
  };
}

async function getCurrentUserInfo(accountId) {
  // Socket/controller thường đi từ account._id -> user_info để làm việc với chat.
  const userInfo = await UserInfoModel.findOne({
    id_account: accountId,
    isDeleted: false
  })
    .select("full_name avatar ma_nv id_account")
    .lean();

  if (!userInfo) {
    throw new ChatError("Không tìm thấy thông tin nhân viên", 404);
  }

  return userInfo;
}

async function loadConversationById(conversationId, currentUserInfoId, session) {
  // Chỉ load conversation nếu user hiện tại là thành viên của conversation đó.
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

  // Receiver có thể được truyền vào bằng user_info._id hoặc account id.
  // Service thử tìm theo user_info trước, sau đó mới fallback sang account id.
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

  const existingConversation = await ConversationModel.findOne({
    type: "private",
    isDeleted: false,
    members: {
      $all: [currentUserInfoId, receiver._id],
      $size: 2
    }
  })
    .populate("members", "full_name avatar ma_nv id_account")
    .populate({
      path: "lastMessage",
      match: { isDeleted: false },
      populate: {
        path: "senderId",
        select: "full_name avatar ma_nv id_account"
      }
    })
    .lean();

  if (existingConversation) {
    // Nếu đã có private chat giữa 2 người thì trả về conversation cũ thay vì tạo mới.
    return formatConversation(existingConversation, currentUserInfoId);
  }

  // Chưa có conversation thì tạo mới với đúng 2 member.
  const conversation = await ConversationModel.create({
    type: "private",
    members: [currentUserInfoId, receiver._id],
    createdBy: currentUserInfoId
  });

  return loadConversationById(conversation._id, currentUserInfoId);
}

async function createMessageDocument({
  conversationId,
  senderUserInfoId,
  content,
  type = "text",
  seenBy = [],
  session
}) {
  // Tách riêng việc tạo message để dùng lại cho cả private/group/system message.
  const payload = {
    conversationId,
    senderId: senderUserInfoId,
    type,
    content: content || "",
    seenBy
  };

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

  // memberIds có thể là user_info._id hoặc account id, nên normalize trước rồi resolve.
  const candidateIds = normalizeObjectIds(memberIds || []);
  // Luôn thêm creator vào group để đảm bảo người tạo là thành viên.
  const withCreator = normalizeObjectIds([...candidateIds, creatorUserInfoId]);
  if (withCreator.length < 2) {
    throw new ChatError("Group phải có ít nhất 2 thành viên", 400);
  }

  // Tìm toàn bộ user tương ứng để xác thực member tồn tại và lấy user_info._id chuẩn.
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

  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    members: userInfoId,
    type: "group",
    isDeleted: false
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
    .lean();

  if (!conversation) {
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
async function listConversations(userInfoId, search = "") {
  // Lấy toàn bộ conversation mà user là member, sau đó format lại cho UI.
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
  // Chỉ thành viên trong conversation mới được đọc message.
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

async function sendMessage({ conversationId, senderUserInfoId, content, type = "text", session }) {
  // Validate membership trước, sau đó mới ghi message và update lastMessage của conversation.
  await ensureConversationAccess(conversationId, senderUserInfoId);

  const allowedTypes = ["text", "image", "audio"];
  if (!allowedTypes.includes(type)) {
    throw new ChatError("Loại tin nhắn không hợp lệ", 400);
  }

  const normalizedContent = String(content || "").trim();
  if (!normalizedContent) {
    throw new ChatError("Nội dung tin nhắn không được để trống", 400);
  }

  const message = await createMessageDocument({
    conversationId,
    senderUserInfoId,
    content: normalizedContent,
    type,
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

  const populatedMessage = await MessageModel.findById(message._id)
    .populate("senderId", "full_name avatar ma_nv id_account")
    .lean();

  return populatedMessage;
}

async function markConversationSeen({ conversationId, userInfoId }) {
  // Đánh dấu seen cho tất cả message trong conversation mà user này chưa đọc.
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

  await Promise.all([
    ConversationModel.updateOne({ _id: conversationId }, { $addToSet: { deletedFor: userInfoId } }),
    MessageModel.updateMany(
      { conversationId, isDeleted: false },
      { $addToSet: { deletedFor: userInfoId } }
    )
  ]);

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
    { $set: { recalled: { at: new Date(), by: userInfoId }, content: "" } },
    { new: true }
  ).populate("senderId", "full_name avatar ma_nv id_account");

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

  const remainingAdmins = conversation.admins.map(String).filter((a) => a !== String(userInfoId));

  await ConversationModel.updateOne(
    { _id: conversationId },
    { $pull: { members: userInfoId, admins: userInfoId } }
  );

  if (remainingAdmins.length === 0) {
    const newAdmin = remainingMembers[Math.floor(Math.random() * remainingMembers.length)];
    await ConversationModel.updateOne({ _id: conversationId }, { $addToSet: { admins: newAdmin } });
  }

  const updatedConv = await loadConversationById(conversationId, remainingMembers[0]);
  return { conversationId: String(conversationId), disbanded: false, conversation: updatedConv };
}

module.exports = {
  ChatError,
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
  formatConversation
};

const mongoose = require("mongoose");
const UserInfoModel = require("../models/UserInfoModel");

function getCommentDepth(comment) {
  if (comment.depth) return comment.depth;
  if (!comment.parent_id) return 1;
  return 2;
}

/**
 * Xử lý vị trí lưu trữ reply (tối đa 3 cấp hiển thị).
 * - depth 1 → reply tạo depth 2 (parent = root)
 * - depth 2 → reply tạo depth 3 (parent = comment depth 2, lồng dưới)
 * - depth 3 → flatten: giữ depth 3, parent = target.parent_id, reply_to = target
 */
function resolveReplyPlacement(parentComment) {
  if (!parentComment) {
    return {
      depth: 1,
      parent_id: null,
      root_id: null,
      reply_to_id: null,
      reply_to_name: null
    };
  }

  const parentDepth = getCommentDepth(parentComment);

  if (parentDepth === 1) {
    return {
      depth: 2,
      parent_id: parentComment._id,
      root_id: parentComment._id,
      reply_to_id: parentComment._id,
      reply_to_name: parentComment.author_name
    };
  }

  if (parentDepth === 2) {
    return {
      depth: 3,
      parent_id: parentComment._id,
      root_id: parentComment.root_id || parentComment.parent_id,
      reply_to_id: parentComment._id,
      reply_to_name: parentComment.author_name
    };
  }

  return {
    depth: 3,
    parent_id: parentComment.parent_id,
    root_id: parentComment.root_id,
    reply_to_id: parentComment._id,
    reply_to_name: parentComment.author_name
  };
}

async function normalizeCommentMentions(mentionsInput, replyToAuthorId = null) {
  let rawMentions = [];

  if (typeof mentionsInput === "string") {
    try {
      rawMentions = JSON.parse(mentionsInput);
    } catch {
      rawMentions = [];
    }
  } else if (Array.isArray(mentionsInput)) {
    rawMentions = mentionsInput;
  }

  const mentionUserIds = new Set();
  rawMentions.forEach((item) => {
    if (item?.user_id && mongoose.Types.ObjectId.isValid(item.user_id)) {
      mentionUserIds.add(item.user_id.toString());
    }
  });

  if (replyToAuthorId && mongoose.Types.ObjectId.isValid(replyToAuthorId)) {
    mentionUserIds.add(replyToAuthorId.toString());
  }

  const uniqueUserIds = Array.from(mentionUserIds).slice(0, 10);
  if (uniqueUserIds.length === 0) return [];

  const validUsers = await UserInfoModel.find(
    { id_account: { $in: uniqueUserIds }, isDeleted: false },
    { id_account: 1, full_name: 1, avatar: 1 }
  ).lean();

  return validUsers.map((user) => ({
    user_id: user.id_account,
    user_name: user.full_name,
    avatar: user.avatar ?? null
  }));
}

function nestComments(roots, depth2List, depth3List) {
  const depth3ByParent = {};
  depth3List.forEach((c) => {
    const key = String(c.parent_id);
    if (!depth3ByParent[key]) depth3ByParent[key] = [];
    depth3ByParent[key].push(c);
  });

  const depth2ByRoot = {};
  depth2List.forEach((c) => {
    const key = String(c.parent_id);
    if (!depth2ByRoot[key]) depth2ByRoot[key] = [];
    const nested = { ...c, replies: depth3ByParent[String(c._id)] || [] };
    depth2ByRoot[key].push(nested);
  });

  return roots.map((root) => ({
    ...root,
    replies: depth2ByRoot[String(root._id)] || []
  }));
}

module.exports = {
  getCommentDepth,
  resolveReplyPlacement,
  normalizeCommentMentions,
  nestComments
};

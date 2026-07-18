const fs = require("fs");
const mongoose = require("mongoose");
const PostModel = require("../models/PostModel");
const CommentModel = require("../models/CommentModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const DepartmentModel = require("../models/DepartmentModel");
const pushNotification = require("../helpers/pushNotification");
const { serializePost, serializeComment, signReactions } = require("../helpers/staticUrl");
const {
  getCommentDepth,
  resolveReplyPlacement,
  normalizeCommentMentions,
  nestComments
} = require("../helpers/commentUtils");
const cleanupUploadedFiles = require("../utils/cleanupUploadedFiles");
const deletePhysicalFile = require("../utils/deletePhysicalFile");

async function getAuthorInfo(accountId) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId });
  if (!userInfo) return { author_name: "Người dùng", author_avatar: null, author_dept: null };

  let author_dept = null;
  const membership = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false
  }).populate("department", "department_name");
  if (membership?.department?.department_name) {
    author_dept = membership.department.department_name;
  }

  return {
    author_name: userInfo.full_name,
    author_avatar: userInfo.avatar ?? null,
    author_dept
  };
}

async function buildAvatarMap(docs) {
  const ids = [...new Set(docs.map((d) => String(d.author_id)).filter(Boolean))];
  if (!ids.length) return {};
  const infos = await UserInfoModel.find(
    { id_account: { $in: ids } },
    { id_account: 1, avatar: 1 }
  ).lean();
  return Object.fromEntries(infos.map((u) => [String(u.id_account), u.avatar ?? null]));
}

function applyAvatarMap(comments, avatarMap) {
  comments.forEach((c) => {
    c.author_avatar = avatarMap[String(c.author_id)] ?? c.author_avatar;
    if (Array.isArray(c.replies)) applyAvatarMap(c.replies, avatarMap);
  });
}

function collectAuthorIds(comments, ids = new Set()) {
  comments.forEach((c) => {
    if (c.author_id) ids.add(String(c.author_id));
    if (Array.isArray(c.replies)) collectAuthorIds(c.replies, ids);
  });
  return ids;
}

async function sendCommentNotifications({
  post,
  postId,
  commenterId,
  commenterName,
  signedComment,
  isRootComment,
  replyToAuthorId,
  mentions
}) {
  const notified = new Set([commenterId.toString()]);

  const notify = (accountId, title, body, data) => {
    const id = accountId?.toString();
    if (!id || notified.has(id)) return;
    notified.add(id);
    pushNotification.sendToAccount({ account_id: accountId, title, body, data }).catch((err) => {
      console.error("[Notification] Gửi thất bại:", err);
    });
  };

  if (isRootComment && post.author_id.toString() !== commenterId.toString()) {
    notify(post.author_id, "Bình luận mới", `${commenterName} đã bình luận bài viết của bạn`, {
      type: "new_comment",
      post_id: postId
    });
  }

  if (replyToAuthorId && replyToAuthorId.toString() !== commenterId.toString()) {
    notify(replyToAuthorId, "Trả lời bình luận", `${commenterName} đã trả lời bình luận của bạn`, {
      type: "comment_reply",
      post_id: postId,
      comment_id: String(signedComment._id)
    });
  }

  (mentions || []).forEach((m) => {
    if (m.user_id?.toString() !== commenterId.toString()) {
      notify(
        m.user_id,
        "Bạn được nhắc đến",
        `${commenterName} đã nhắc đến bạn trong một bình luận`,
        { type: "comment_mention", post_id: postId, comment_id: String(signedComment._id) }
      );
    }
  });
}

const PostController = {
  // GET /posts
  getPosts: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, parseInt(req.query.limit, 10) || 15);
      const { dept_id, type, author_id } = req.query;

      const filter = { isDeleted: false };
      if (dept_id) filter.dept_id = dept_id;
      if (type) filter.type = type;
      if (author_id) filter.author_id = author_id;

      const total = await PostModel.countDocuments(filter);
      const posts = await PostModel.find(filter)
        .sort({ pinned: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Thu thập tất cả user_id: tác giả bài + người dùng đã react
      const allIds = [
        ...new Set(
          [
            ...posts.map((p) => String(p.author_id)),
            ...posts.flatMap((p) => (p.reactions ?? []).map((r) => String(r.user_id)))
          ].filter(Boolean)
        )
      ];
      let avatarMap = {};
      if (allIds.length) {
        const infos = await UserInfoModel.find(
          { id_account: { $in: allIds } },
          { id_account: 1, avatar: 1 }
        ).lean();
        avatarMap = Object.fromEntries(infos.map((u) => [String(u.id_account), u.avatar ?? null]));
      }
      posts.forEach((p) => {
        p.author_avatar = avatarMap[String(p.author_id)] ?? p.author_avatar;
        (p.reactions ?? []).forEach((r) => {
          const uid = String(r.user_id);
          if (avatarMap[uid] !== undefined) r.author_avatar = avatarMap[uid];
        });
      });

      return res.status(200).json({
        message: "Thành công",
        data: posts.map(serializePost),
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /posts
  createPost: async (req, res) => {
    try {
      const { content, type = "post", visibility = "all", dept_id } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Nội dung bài viết không được để trống" });
      }

      if (type === "announcement") {
        const { role, module_access } = req.account;
        const canManage =
          role === "admin" || (role === "manager" && module_access.includes("workplace"));
        if (!canManage) {
          return res.status(403).json({ message: "Chỉ quản lý mới có thể đăng thông báo" });
        }
      }

      const { author_name, author_avatar, author_dept } = await getAuthorInfo(req.account._id);

      const images = (req.files || []).map((f) => `feed/${f.filename}`);

      const post = await PostModel.create({
        author_id: req.account._id,
        author_name,
        author_avatar,
        author_dept,
        content: content.trim(),
        images,
        type,
        visibility,
        dept_id: dept_id || null
      });

      const signedPost = serializePost(post);
      const io = req.app.get("io");
      if (io) io.to("feed").emit("new_post", { post: signedPost });

      return res.status(200).json({ message: "Đăng bài thành công", data: signedPost });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /posts/:id/react
  reactPost: async (req, res) => {
    try {
      const { id } = req.params;
      const { type = "like" } = req.body;
      const accountId = req.account._id.toString();

      const validTypes = ["like", "love", "haha", "wow", "sad", "angry"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Loại cảm xúc không hợp lệ" });
      }

      const post = await PostModel.findOne({ _id: id, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Không tìm thấy bài viết" });

      const { author_name, author_avatar } = await getAuthorInfo(accountId);
      const existingIdx = post.reactions.findIndex((r) => r.user_id.toString() === accountId);
      if (existingIdx !== -1) {
        if (post.reactions[existingIdx].type === type) {
          post.reactions.splice(existingIdx, 1);
        } else {
          post.reactions[existingIdx].type = type;
        }
      } else {
        post.reactions.push({ user_id: accountId, type, author_name, author_avatar });
      }
      await post.save();

      const signedReactions = signReactions(post.reactions);
      const io = req.app.get("io");
      if (io) {
        const payload = { post_id: id, reactions: signedReactions };
        io.to("feed").emit("reaction_updated", payload);
        io.to(`post:${id}`).emit("reaction_updated", payload);
      }

      return res.status(200).json({
        message: "Thành công",
        data: { reactions: signedReactions }
      });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PATCH /posts/:id/edit
  editPost: async (req, res) => {
    try {
      const { id } = req.params;
      const { content, visibility, dept_id, keep_images } = req.body;
      const accountId = req.account._id.toString();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        if (req.files && req.files.length > 0) {
          req.files.forEach((f) => cleanupUploadedFiles(f, "invalid-id"));
        }
        return res.status(400).json({ message: "ID bài viết không hợp lệ" });
      }

      const post = await PostModel.findOne({ _id: id, isDeleted: false });
      if (!post) {
        if (req.files && req.files.length > 0) {
          req.files.forEach((f) => cleanupUploadedFiles(f, "post-not-found"));
        }
        return res.status(404).json({ message: "Không tìm thấy bài viết" });
      }

      if (post.author_id.toString() !== accountId) {
        if (req.files && req.files.length > 0) {
          req.files.forEach((f) => cleanupUploadedFiles(f, "permission-denied"));
        }
        return res.status(403).json({ message: "Bạn không có quyền chỉnh sửa bài viết này" });
      }

      if (content !== undefined && (!content || !content.trim())) {
        if (req.files && req.files.length > 0) {
          req.files.forEach((f) => cleanupUploadedFiles(f, "empty-content"));
        }
        return res.status(400).json({ message: "Nội dung bài viết không được để trống" });
      }

      if (content !== undefined) post.content = content.trim();
      if (visibility !== undefined) post.visibility = visibility;
      if (dept_id !== undefined) post.dept_id = dept_id || null;

      const newImages = (req.files || []).map((f) => `feed/${f.filename}`);
      let deletedImages = [];

      if ((req.files && req.files.length > 0) || keep_images !== undefined) {
        let finalImages = [];

        if (keep_images) {
          try {
            const parsedKeepImages =
              typeof keep_images === "string" ? JSON.parse(keep_images) : keep_images;

            if (Array.isArray(parsedKeepImages)) {
              finalImages = post.images.filter((img) => parsedKeepImages.includes(img));
            }
          } catch (e) {
            finalImages = post.images;
          }
        } else if (req.files && req.files.length > 0) {
          finalImages = [];
        } else {
          finalImages = post.images;
        }

        deletedImages = post.images.filter((img) => !finalImages.includes(img));
        post.images = [...finalImages, ...newImages];
      }

      await post.save();

      deletedImages.forEach((img) => {
        deletePhysicalFile(img);
      });

      let signedPost;
      try {
        const { author_avatar } = await getAuthorInfo(accountId);
        post.author_avatar = author_avatar ?? post.author_avatar;

        signedPost = serializePost(post);

        const io = req.app.get("io");
        if (io) {
          io.to("feed").emit("post_updated", { post: signedPost });
          io.to(`post:${id}`).emit("post_updated", { post: signedPost });
        }
      } catch (postProcessError) {
        console.error("Lỗi xử lý phụ sau khi lưu bài viết:", postProcessError);
        return res.status(200).json({
          message: "Cập nhật bài viết thành công (lỗi xử lý phụ)",
          data: serializePost(post),
          error: postProcessError.message
        });
      }

      return res.status(200).json({
        message: "Cập nhật bài viết thành công",
        data: signedPost
      });
    } catch (error) {
      if (req.files && req.files.length > 0) {
        req.files.forEach((f) => cleanupUploadedFiles(f, "server-error"));
      }
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // DELETE /posts/:id
  deletePost: async (req, res) => {
    try {
      const { id } = req.params;
      const { _id: accountId, role } = req.account;

      const post = await PostModel.findOne({ _id: id, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Không tìm thấy bài viết" });

      const isAuthor = post.author_id.toString() === accountId;
      if (!isAuthor && role !== "admin") {
        return res.status(403).json({ message: "Bạn không có quyền xóa bài viết này" });
      }

      post.isDeleted = true;
      await post.save();

      const io = req.app.get("io");
      if (io) io.to("feed").emit("post_deleted", { post_id: id });

      return res.status(200).json({ message: "Đã xóa bài viết" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // PATCH /posts/:id/pin
  pinPost: async (req, res) => {
    try {
      const { id } = req.params;

      const post = await PostModel.findOne({ _id: id, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Không tìm thấy bài viết" });

      post.pinned = !post.pinned;
      await post.save();

      const io = req.app.get("io");
      if (io) io.to("feed").emit("post_pinned", { post_id: id, pinned: post.pinned });

      return res.status(200).json({
        message: post.pinned ? "Đã ghim bài viết" : "Đã bỏ ghim bài viết",
        data: { pinned: post.pinned }
      });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /posts/:id/comments
  getComments: async (req, res) => {
    try {
      const { id } = req.params;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
      const sortDir = req.query.sort === "desc" ? -1 : 1;

      const rootFilter = { post_id: id, parent_id: null, isDeleted: false };
      const total = await CommentModel.countDocuments(rootFilter);
      const roots = await CommentModel.find(rootFilter)
        .sort({ createdAt: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const rootIds = roots.map((r) => r._id);
      let depth2List = [];
      let depth3List = [];

      if (rootIds.length) {
        depth2List = await CommentModel.find({
          post_id: id,
          parent_id: { $in: rootIds },
          depth: 2,
          isDeleted: false
        })
          .sort({ createdAt: 1 })
          .lean();

        const depth2Ids = depth2List.map((c) => c._id);
        if (depth2Ids.length) {
          depth3List = await CommentModel.find({
            post_id: id,
            parent_id: { $in: depth2Ids },
            depth: 3,
            isDeleted: false
          })
            .sort({ createdAt: 1 })
            .lean();
        }
      }

      const nested = nestComments(roots, depth2List, depth3List);
      const allFlat = [...roots, ...depth2List, ...depth3List];
      const avatarMap = await buildAvatarMap(allFlat);
      applyAvatarMap(nested, avatarMap);

      return res.status(200).json({
        message: "Thành công",
        data: nested.map(serializeComment),
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /posts/:id/comments
  createCommentWithImages: async (req, res) => {
    const uploadedFile = req.file || null;
    const { id: postId } = req.params;
    const { content, parent_id: parentId, mentions: mentionsInput } = req.body;

    const hasContent = content && content.trim();
    const hasImage = !!uploadedFile;

    if (!hasContent && !hasImage) {
      cleanupUploadedFiles(uploadedFile, "empty-content");
      return res
        .status(400)
        .json({ message: "Nội dung bình luận hoặc hình ảnh không được để trống" });
    }

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      cleanupUploadedFiles(uploadedFile, "invalid-id");
      return res.status(400).json({ message: "ID bài viết không hợp lệ" });
    }

    if (parentId && !mongoose.Types.ObjectId.isValid(parentId)) {
      cleanupUploadedFiles(uploadedFile, "invalid-parent-id");
      return res.status(400).json({ message: "ID bình luận cha không hợp lệ" });
    }

    let session;
    let isCommitted = false;
    let signedComment;
    let updatedPost;
    let post;
    let commenter_name;
    let mentions = [];
    let replyToAuthorId = null;
    const isRootComment = !parentId;

    try {
      const authorInfo = await getAuthorInfo(req.account._id);
      commenter_name = authorInfo.author_name;
      const { author_avatar } = authorInfo;

      session = await mongoose.startSession();
      session.startTransaction();

      post = await PostModel.findOne({ _id: postId, isDeleted: false }).session(session);
      if (!post) {
        await session.abortTransaction();
        await session.endSession();
        cleanupUploadedFiles(uploadedFile, "post-not-found");
        return res.status(404).json({ message: "Không tìm thấy bài viết" });
      }

      // 1. Khởi chạy resolveReplyPlacement với giá trị mặc định là null (cho comment gốc)
      // Nếu có parentId, biến này sẽ được ghi đè sau khi tìm thấy parentComment hợp lệ.
      let placement = resolveReplyPlacement(null);
      let parentComment = null;

      if (parentId) {
        parentComment = await CommentModel.findOne({
          _id: parentId,
          post_id: postId,
          isDeleted: false
        })
          .session(session)
          .lean();

        if (!parentComment) {
          await session.abortTransaction();
          await session.endSession();
          cleanupUploadedFiles(uploadedFile, "parent-not-found");
          return res.status(404).json({ message: "Không tìm thấy bình luận được trả lời" });
        }

        // Tận dụng hàm resolveReplyPlacement có sẵn để tự động tính toán depth, parent_id, root_id, reply_to
        placement = resolveReplyPlacement(parentComment);
        replyToAuthorId = parentComment.author_id;
      }

      // Tận dụng hàm normalizeCommentMentions có sẵn để chuẩn hóa tag tên
      mentions = await normalizeCommentMentions(mentionsInput, replyToAuthorId);

      const image = uploadedFile ? `feed/${uploadedFile.filename}` : null;

      const [comment] = await CommentModel.create(
        [
          {
            post_id: postId,
            author_id: req.account._id,
            author_name: commenter_name,
            author_avatar,
            content: content ? content.trim() : "",
            image,
            depth: placement.depth,
            parent_id: placement.parent_id,
            root_id: placement.root_id,
            reply_to_id: placement.reply_to_id,
            reply_to_name: placement.reply_to_name,
            mentions
          }
        ],
        { session }
      );

      updatedPost = await PostModel.findOneAndUpdate(
        { _id: postId, isDeleted: false },
        { $inc: { comments_count: 1 } },
        { session, new: true }
      );

      if (!updatedPost) {
        await session.abortTransaction();
        await session.endSession();
        cleanupUploadedFiles(uploadedFile, "post-not-found-2");
        return res.status(404).json({ message: "Không tìm thấy bài viết" });
      }

      // 2. Tăng replies_count chuẩn xác theo cấp hiển thị[cite: 2]
      if (placement.parent_id) {
        let targetIncrementId = null;

        if (placement.depth === 2) {
          // Reply cho root (depth 1) -> Tăng replies_count trên chính root gốc (A)[cite: 2]
          targetIncrementId = placement.root_id;
        } else if (placement.depth === 3) {
          // Reply cho comment phụ (depth 2 hoặc depth 3 flatten) -> Tăng replies_count trên comment cha cấp 2 (B)[cite: 2]
          targetIncrementId = placement.parent_id;
        }

        if (targetIncrementId) {
          await CommentModel.updateOne(
            { _id: targetIncrementId, isDeleted: false },
            { $inc: { replies_count: 1 } },
            { session }
          );
        }
      }

      await session.commitTransaction();
      await session.endSession();
      isCommitted = true;

      signedComment = serializeComment(comment.toObject ? comment.toObject() : comment);
    } catch (error) {
      console.error("Đã xảy ra lỗi khi tạo bình luận:", error);

      if (session && !isCommitted) {
        try {
          await session.abortTransaction();
          await session.endSession();
        } catch (abortError) {
          console.error("Không thể abort transaction:", abortError);
        }
      }

      cleanupUploadedFiles(uploadedFile, "create-comment-failed");
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`post:${postId}`).emit("new_comment", { comment: signedComment });
        io.to("feed").emit("comment_count_updated", {
          post_id: postId,
          comments_count: updatedPost.comments_count
        });
      }

      await sendCommentNotifications({
        post,
        postId,
        commenterId: req.account._id,
        commenterName: commenter_name,
        signedComment,
        isRootComment,
        replyToAuthorId: parentId ? replyToAuthorId : null,
        mentions
      });
    } catch (realtimeError) {
      console.error("Lỗi đồng bộ realtime:", realtimeError);
      return res.status(200).json({
        message: "Bình luận thành công (lỗi đồng bộ realtime)",
        data: signedComment,
        error: realtimeError.message
      });
    }

    return res.status(200).json({ message: "Bình luận thành công", data: signedComment });
  },

  // DELETE /posts/:id/comments/:commentId
  deleteComment: async (req, res) => {
    try {
      const { id: postId, commentId } = req.params;
      const { _id: accountId, role } = req.account;

      const comment = await CommentModel.findOne({
        _id: commentId,
        post_id: postId,
        isDeleted: false
      });
      if (!comment) return res.status(404).json({ message: "Không tìm thấy bình luận" });

      const isAuthor = comment.author_id.toString() === accountId.toString();
      if (!isAuthor && role !== "admin") {
        return res.status(403).json({ message: "Bạn không có quyền xóa bình luận này" });
      }

      const depth = getCommentDepth(comment);
      let idsToDelete = [comment._id];

      if (depth === 1) {
        const descendants = await CommentModel.find({
          post_id: postId,
          root_id: commentId,
          isDeleted: false
        })
          .select("_id")
          .lean();
        idsToDelete = [comment._id, ...descendants.map((d) => d._id)];
      } else if (depth === 2) {
        const depth3 = await CommentModel.find({
          post_id: postId,
          parent_id: commentId,
          depth: 3,
          isDeleted: false
        })
          .select("_id")
          .lean();
        idsToDelete = [comment._id, ...depth3.map((d) => d._id)];
      }

      await CommentModel.updateMany({ _id: { $in: idsToDelete } }, { $set: { isDeleted: true } });

      const deleteCount = idsToDelete.length;
      await PostModel.findByIdAndUpdate(postId, { $inc: { comments_count: -deleteCount } });

      if (depth === 2 && comment.parent_id) {
        await CommentModel.updateOne({ _id: comment.parent_id }, { $inc: { replies_count: -1 } });
      } else if (depth === 3 && comment.parent_id) {
        await CommentModel.updateOne({ _id: comment.parent_id }, { $inc: { replies_count: -1 } });
      }

      const io = req.app.get("io");
      if (io) {
        idsToDelete.forEach((id) => {
          io.to(`post:${postId}`).emit("comment_deleted", {
            comment_id: String(id),
            parent_id: comment.parent_id ? String(comment.parent_id) : null,
            depth
          });
        });
      }

      return res.status(200).json({ message: "Đã xóa bình luận" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  }
};

module.exports = PostController;

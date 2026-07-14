const fs = require("fs");
const mongoose = require("mongoose");
const PostModel = require("../models/PostModel");
const CommentModel = require("../models/CommentModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const DepartmentModel = require("../models/DepartmentModel");
const pushNotification = require("../helpers/pushNotification");
const { serializePost, serializeComment, signReactions } = require("../helpers/staticUrl");

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

// Nhận mảng docs có author_id, trả về map { accountId → avatar }
async function buildAvatarMap(docs) {
  const ids = [...new Set(docs.map((d) => String(d.author_id)).filter(Boolean))];
  if (!ids.length) return {};
  const infos = await UserInfoModel.find(
    { id_account: { $in: ids } },
    { id_account: 1, avatar: 1 }
  ).lean();
  return Object.fromEntries(infos.map((u) => [String(u.id_account), u.avatar ?? null]));
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
      const filter = { post_id: id, isDeleted: false };
      const total = await CommentModel.countDocuments(filter);
      const comments = await CommentModel.find(filter)
        .sort({ createdAt: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const avatarMap = await buildAvatarMap(comments);
      comments.forEach((c) => {
        c.author_avatar = avatarMap[String(c.author_id)] ?? c.author_avatar;
      });

      return res.status(200).json({
        message: "Thành công",
        data: comments.map(serializeComment),
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
  createComment: async (req, res) => {
    try {
      const { id: postId } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ message: "Nội dung bình luận không được để trống" });
      }

      const post = await PostModel.findOne({ _id: postId, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Không tìm thấy bài viết" });

      const { author_name, author_avatar } = await getAuthorInfo(req.account._id);

      const comment = await CommentModel.create({
        post_id: postId,
        author_id: req.account._id,
        author_name,
        author_avatar,
        content: content.trim()
      });

      post.comments_count = (post.comments_count || 0) + 1;
      await post.save();

      const signedComment = serializeComment(comment);
      const io = req.app.get("io");
      if (io) {
        io.to(`post:${postId}`).emit("new_comment", { comment: signedComment });
        io.to("feed").emit("comment_count_updated", {
          post_id: postId,
          comments_count: post.comments_count
        });
      }

      const isNotSameUser = post.author_id.toString() !== req.account._id;
      if (isNotSameUser) {
        pushNotification
          .sendToAccount({
            account_id: post.author_id,
            title: "Bình luận mới",
            body: `${author_name} đã bình luận bài viết của bạn`,
            data: { type: "new_comment", post_id: postId }
          })
          .catch(() => {});
      }

      return res.status(200).json({ message: "Bình luận thành công", data: signedComment });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /posts/:id/comments
  createCommentWithImages: async (req, res) => {
    const uploadedFiles = req.files || [];

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { id: postId } = req.params;
      const { content } = req.body;

      const hasContent = content && content.trim();
      const hasImages = uploadedFiles.length > 0;

      if (!hasContent && !hasImages) {
        uploadedFiles.forEach((f) => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        await session.endSession();
        return res
          .status(400)
          .json({ message: "Nội dung bình luận hoặc hình ảnh không được để trống" });
      }

      const post = await PostModel.findOne({ _id: postId, isDeleted: false }).session(session);
      if (!post) {
        uploadedFiles.forEach((f) => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        await session.endSession();
        return res.status(404).json({ message: "Không tìm thấy bài viết" });
      }

      const { author_name, author_avatar } = await getAuthorInfo(req.account._id);

      const images = uploadedFiles.map((f) => `feed/${f.filename}`);

      const [comment] = await CommentModel.create(
        [
          {
            post_id: postId,
            author_id: req.account._id,
            author_name,
            author_avatar,
            content: content ? content.trim() : "",
            images
          }
        ],
        { session }
      );

      post.comments_count = (post.comments_count || 0) + 1;
      await post.save({ session });

      // 🔥 COMMIT TRANSACTION: Lưu đồng thời toàn bộ thay đổi trên vào DB
      await session.commitTransaction();
      await session.endSession();

      const signedComment = serializeComment(comment);
      const io = req.app.get("io");
      if (io) {
        io.to(`post:${postId}`).emit("new_comment", { comment: signedComment });
        io.to("feed").emit("comment_count_updated", {
          post_id: postId,
          comments_count: post.comments_count
        });
      }

      const isNotSameUser = post.author_id.toString() !== req.account._id;
      if (isNotSameUser) {
        pushNotification
          .sendToAccount({
            account_id: post.author_id,
            title: "Bình luận mới",
            body: `${author_name} đã bình luận bài viết của bạn`,
            data: { type: "new_comment", post_id: postId }
          })
          .catch(() => {});
      }

      return res.status(200).json({ message: "Bình luận thành công", data: signedComment });
    } catch (error) {
      await session.abortTransaction();
      await session.endSession();
      uploadedFiles.forEach((file) => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            console.log(`[Rollback] Đã xóa file rác comment thành công: ${file.path}`);
          }
        } catch (unlinkError) {
          console.error(`[Rollback] Không thể xóa file lỗi:`, unlinkError);
        }
      });
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
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

      const isAuthor = comment.author_id.toString() === accountId;
      if (!isAuthor && role !== "admin") {
        return res.status(403).json({ message: "Bạn không có quyền xóa bình luận này" });
      }

      comment.isDeleted = true;
      await comment.save();

      await PostModel.findByIdAndUpdate(postId, { $inc: { comments_count: -1 } });

      const io = req.app.get("io");
      if (io) io.to(`post:${postId}`).emit("comment_deleted", { comment_id: commentId });

      return res.status(200).json({ message: "Đã xóa bình luận" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  }
};

module.exports = PostController;

const PostModel = require("../models/PostModel");
const CommentModel = require("../models/CommentModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const DepartmentModel = require("../models/DepartmentModel");
const pushNotification = require("../helpers/pushNotification");

async function getAuthorInfo(accountId) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId });
  if (!userInfo) return { author_name: "Người dùng", author_avatar: null, author_dept: null };

  let author_dept = null;
  const membership = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false,
  }).populate("department", "department_name");
  if (membership?.department?.department_name) {
    author_dept = membership.department.department_name;
  }

  return {
    author_name: userInfo.full_name,
    author_avatar: userInfo.avatar ?? null,
    author_dept,
  };
}

const PostController = {
  // GET /posts
  getPosts: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, parseInt(req.query.limit) || 15);
      const { dept_id, type } = req.query;

      const filter = { isDeleted: false };
      if (dept_id) filter.dept_id = dept_id;
      if (type) filter.type = type;

      const total = await PostModel.countDocuments(filter);
      const posts = await PostModel.find(filter)
        .sort({ pinned: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return res.status(200).json({
        message: "Thành công",
        data: posts,
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit),
        },
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
        dept_id: dept_id || null,
      });

      const io = req.app.get("io");
      if (io) io.to("feed").emit("new_post", { post });

      return res.status(200).json({ message: "Đăng bài thành công", data: post });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // POST /posts/:id/like
  likePost: async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = req.account._id;

      const post = await PostModel.findOne({ _id: id, isDeleted: false });
      if (!post) return res.status(404).json({ message: "Không tìm thấy bài viết" });

      const alreadyLiked = post.likes.some((uid) => uid.toString() === accountId);
      if (alreadyLiked) {
        post.likes = post.likes.filter((uid) => uid.toString() !== accountId);
      } else {
        post.likes.push(accountId);
      }
      await post.save();

      const io = req.app.get("io");
      if (io) {
        io.to(`post:${id}`).emit("like_updated", {
          post_id: id,
          likes_count: post.likes.length,
        });
      }

      return res.status(200).json({
        message: alreadyLiked ? "Đã bỏ thích" : "Đã thích bài viết",
        data: { likes_count: post.likes.length, liked: !alreadyLiked },
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
        data: { pinned: post.pinned },
      });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // GET /posts/:id/comments
  getComments: async (req, res) => {
    try {
      const { id } = req.params;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, parseInt(req.query.limit) || 20);

      const filter = { post_id: id, isDeleted: false };
      const total = await CommentModel.countDocuments(filter);
      const comments = await CommentModel.find(filter)
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return res.status(200).json({
        message: "Thành công",
        data: comments,
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit),
        },
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
        content: content.trim(),
      });

      post.comments_count = (post.comments_count || 0) + 1;
      await post.save();

      const io = req.app.get("io");
      if (io) io.to(`post:${postId}`).emit("new_comment", { comment });

      const isNotSameUser = post.author_id.toString() !== req.account._id;
      if (isNotSameUser) {
        pushNotification
          .sendToAccount({
            account_id: post.author_id,
            title: "Bình luận mới",
            body: `${author_name} đã bình luận bài viết của bạn`,
            data: { type: "new_comment", post_id: postId },
          })
          .catch(() => {});
      }

      return res.status(200).json({ message: "Bình luận thành công", data: comment });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  // DELETE /posts/:id/comments/:commentId
  deleteComment: async (req, res) => {
    try {
      const { id: postId, commentId } = req.params;
      const { _id: accountId, role } = req.account;

      const comment = await CommentModel.findOne({ _id: commentId, post_id: postId, isDeleted: false });
      if (!comment) return res.status(404).json({ message: "Không tìm thấy bình luận" });

      const isAuthor = comment.author_id.toString() === accountId;
      if (!isAuthor && role !== "admin") {
        return res.status(403).json({ message: "Bạn không có quyền xóa bình luận này" });
      }

      comment.isDeleted = true;
      await comment.save();

      await PostModel.findByIdAndUpdate(postId, { $inc: { comments_count: -1 } });

      return res.status(200).json({ message: "Đã xóa bình luận" });
    } catch (error) {
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },
};

module.exports = PostController;

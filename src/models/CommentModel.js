const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const { ObjectId } = mongoose.Schema.Types;

const CommentSchema = new mongoose.Schema(
  {
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: "post", required: true },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    author_name: { type: String, required: true },
    author_avatar: { type: String, default: null },
    content: {
      type: String,
      maxlength: 500,
      required() {
        return !this.image;
      }
    },
    image: { type: String, default: null },
    ...BaseSchema.obj,

    parent_id: { type: ObjectId, ref: "comment", default: null },
    reply_to_id: { type: ObjectId, ref: "comment", default: null },
    reply_to_name: { type: String, default: null },
    mentions: [
      {
        user_id: { type: ObjectId, ref: "account", required: true },
        user_name: { type: String, required: true },
        avatar: { type: String, default: null }
      }
    ],
    depth: { type: Number, enum: [1, 2, 3], default: 1 }, // cấp hiển thị
    root_id: { type: ObjectId, ref: "comment", default: null }, // luôn trỏ A (comment gốc của nhánh)
    // parent_id: null = root; depth 2 → parent = root; depth 3 → parent = comment depth 2
    replies_count: { type: Number, default: 0 } // trên root (đếm depth 2) và trên depth 2 (đếm depth 3)
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "comments"
  }
);
CommentSchema.index({ post_id: 1, parent_id: null, createdAt: -1 });
CommentSchema.index({ post_id: 1, root_id: 1 });
CommentSchema.index({ parent_id: 1, createdAt: 1 });

CommentSchema.pre("validate", function (next) {
  const hasContent = this.content && this.content.trim().length > 0;
  const hasImage = !!this.image;

  if (!hasContent && !hasImage) {
    this.invalidate("content", "Nội dung bình luận hoặc hình ảnh không được để trống");
  }
  next();
});

module.exports = mongoose.model("comment", CommentSchema);

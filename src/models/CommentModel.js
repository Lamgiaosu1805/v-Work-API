const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

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
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "comments"
  }
);
CommentSchema.pre("validate", function (next) {
  const hasContent = this.content && this.content.trim().length > 0;
  const hasImage = !!this.image;

  if (!hasContent && !hasImage) {
    this.invalidate("content", "Nội dung bình luận hoặc hình ảnh không được để trống");
  }
  next();
});

module.exports = mongoose.model("comment", CommentSchema);

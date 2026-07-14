const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const CommentSchema = new mongoose.Schema(
  {
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: "post", required: true },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    author_name: { type: String, required: true },
    author_avatar: { type: String, default: null },
    // content: { type: String, required: true, maxlength: 500 },
    content: {
      type: String,
      maxlength: 500,
      required() {
        return !this.images || this.images.length === 0;
      }
    },
    images: [{ type: String }], // Mảng chứa đường dẫn hình ảnh
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "comments"
  }
);

module.exports = mongoose.model("comment", CommentSchema);

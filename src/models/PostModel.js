const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const PostSchema = new mongoose.Schema({
  author_id: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
  author_name: { type: String, required: true },
  author_avatar: { type: String, default: null },
  author_dept: { type: String, default: null },
  content: { type: String, required: true, maxlength: 2000 },
  images: [{ type: String }],
  type: { type: String, enum: ["post", "announcement"], default: "post" },
  visibility: { type: String, enum: ["all", "department"], default: "all" },
  dept_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", default: null },
  pinned: { type: Boolean, default: false },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "account" }],
  comments_count: { type: Number, default: 0 },
  ...BaseSchema.obj,
}, {
  timestamps: BaseSchema.options.timestamps,
  toJSON: BaseSchema.options.toJSON,
  toObject: BaseSchema.options.toObject,
  collection: "posts",
});

module.exports = mongoose.model("post", PostSchema);

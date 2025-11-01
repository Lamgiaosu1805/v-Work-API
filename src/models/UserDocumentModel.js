const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const UserDocumentModel = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    documents: [
      {
        type_id: { type: mongoose.Schema.Types.ObjectId, ref: "document_type", required: true },
        attachments: [
          {
            file_name: { type: String, required: true },
            file_url: { type: String, required: true },
            uploaded_at: { type: Date, default: Date.now },
            uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
            allowed_users: [{ type: mongoose.Schema.Types.ObjectId, ref: "user_info" }],
          },
        ],
        note: { type: String },
      },
    ],
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("user_document", UserDocumentModel);

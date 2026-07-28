const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const SCOPE_TYPES = ["all_departments", "specific_departments"];

const FOLDER_ACTION = Object.freeze({
  VIEW: "view",
  DOWNLOAD: "download",
  UPLOAD: "upload",
  DELETE_FILE: "delete_file",
  MANAGE: "manage"
});

const FOLDER_ACTION_VALUES = Object.values(FOLDER_ACTION);

const PermissionEntrySchema = new mongoose.Schema(
  {
    subjectType: { type: String, enum: ["user", "department"], required: true },

    refModel: { type: String, enum: ["account", "department"], required: true },

    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "refModel"
    },

    actions: {
      type: [String],
      enum: FOLDER_ACTION_VALUES,
      default: [FOLDER_ACTION.VIEW]
    }
  },
  { _id: false }
);

const SharedFolderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },

    parent_id: { type: mongoose.Schema.Types.ObjectId, ref: "shared_folder", default: null },

    scope: { type: String, enum: SCOPE_TYPES, default: "all_departments" },
    visibleDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: "department" }],

    permissions: { type: [PermissionEntrySchema], default: [] },

    defaultActions: {
      type: [String],
      enum: FOLDER_ACTION_VALUES,
      default: [FOLDER_ACTION.VIEW]
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
    deletedAt: { type: Date, default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

SharedFolderSchema.index({ parent_id: 1 });
SharedFolderSchema.index({ "permissions.subjectId": 1 });

module.exports = mongoose.model("shared_folder", SharedFolderSchema);
module.exports.SCOPE_TYPES = SCOPE_TYPES;
module.exports.FOLDER_ACTION = FOLDER_ACTION;
module.exports.FOLDER_ACTION_VALUES = FOLDER_ACTION_VALUES;

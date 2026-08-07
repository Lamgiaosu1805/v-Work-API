const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AUDIT_ACTION = Object.freeze({
  // Folder
  VIEW_FOLDER: "view_folder",
  CREATE_FOLDER: "create_folder",
  RENAME_FOLDER: "rename_folder",
  MOVE_FOLDER: "move_folder",
  DELETE_FOLDER: "delete_folder",
  UPDATE_PERMISSIONS: "update_permissions",
  UPDATE_DEFAULT_ACTIONS: "update_default_actions",
  UPDATE_AUTO_CLEANUP: "update_auto_cleanup",
  AUTO_CLEANUP_DELETE_FOLDER: "auto_cleanup_delete_folder",

  // File
  UPLOAD_FILE: "upload_file",
  VIEW_FILE: "view_file",
  DOWNLOAD_FILE: "download_file",
  RENAME_FILE: "rename_file",
  MOVE_FILE: "move_file",
  DELETE_FILE: "delete_file",
  AUTO_CLEANUP_DELETE_FILE: "auto_cleanup_delete_file"
});

const AUDIT_ACTION_VALUES = Object.values(AUDIT_ACTION);

const TARGET_TYPES = Object.freeze({
  FOLDER: "folder",
  FILE: "file"
});

const TARGET_TYPE_VALUES = Object.values(TARGET_TYPES);

const SharedFolderAuditLogSchema = new mongoose.Schema(
  {
    rootFolderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "shared_folder",
      default: null,
      index: true
    },

    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "shared_folder",
      default: null,
      index: true
    },

    targetType: {
      type: String,
      enum: TARGET_TYPE_VALUES,
      required: true
    },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },

    action: {
      type: String,
      enum: AUDIT_ACTION_VALUES,
      required: true,
      index: true
    },

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "account",
      default: null,
      index: true
    },

    targetName: {
      type: String,
      default: ""
    },

    message: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

SharedFolderAuditLogSchema.index({
  rootFolderId: 1,
  createdAt: -1
});

SharedFolderAuditLogSchema.index({
  folderId: 1,
  createdAt: -1
});

SharedFolderAuditLogSchema.index({
  performedBy: 1,
  createdAt: -1
});

SharedFolderAuditLogSchema.index({
  targetType: 1,
  targetId: 1,
  createdAt: -1
});

module.exports = mongoose.model("shared_folder_audit_log", SharedFolderAuditLogSchema);

module.exports.AUDIT_ACTION = AUDIT_ACTION;
module.exports.AUDIT_ACTION_VALUES = AUDIT_ACTION_VALUES;
module.exports.TARGET_TYPES = TARGET_TYPES;
module.exports.TARGET_TYPE_VALUES = TARGET_TYPE_VALUES;

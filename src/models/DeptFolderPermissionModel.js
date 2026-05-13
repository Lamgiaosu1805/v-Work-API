const mongoose = require("mongoose");

// Lưu quyền truy cập cross-department vào folder nội bộ.
// Mỗi department có tối đa 1 document trong collection này.
const DeptFolderPermissionSchema = new mongoose.Schema(
    {
        department: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "department",
            required: true,
            unique: true,
        },
        grantedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "account" }],
        grantedDepts: [{ type: mongoose.Schema.Types.ObjectId, ref: "department" }],
    },
    { timestamps: true }
);

module.exports = mongoose.model("dept_folder_permission", DeptFolderPermissionSchema);

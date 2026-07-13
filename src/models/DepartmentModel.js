const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const DEPT_TYPES = ["holding", "board", "division", "department", "branch"];
const LEAF_TYPES = ["department", "branch"];

const DepartmentModel = new mongoose.Schema(
  {
    department_name: { type: String, required: true },
    department_code: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    type: { type: String, enum: DEPT_TYPES, default: "department" },
    address: { type: String, default: "" },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "department", default: null },
    is_active: { type: Boolean, default: true },
    // "Quản lý gián tiếp" (tier-2, theo PHÂN QUYỀN V-WORK) — người phụ trách phòng ban
    // này nhưng KHÔNG phải nhân viên biên chế ở đây (khác UserDepartmentPositionModel,
    // vốn là quan hệ "làm việc tại"). 1 người có thể là manager của nhiều phòng ban
    // không liền nhánh (vd 1 Phó TGĐ phụ trách nhiều khối khác nhau).
    manager: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

module.exports = mongoose.model("department", DepartmentModel);
module.exports.DEPT_TYPES = DEPT_TYPES;
module.exports.LEAF_TYPES = LEAF_TYPES;

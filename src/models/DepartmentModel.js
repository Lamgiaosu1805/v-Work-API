const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const DEPT_TYPES = ["holding", "board", "division", "department", "branch"];
const LEAF_TYPES = ["department", "branch"]; // node lá — gán nhân viên + tạo folder

const DepartmentModel = new mongoose.Schema(
    {
        department_name: { type: String, required: true },
        department_code: { type: String, required: true, unique: true },
        description: { type: String, default: "" },
        type: { type: String, enum: DEPT_TYPES, default: "department" },
        address: { type: String, default: "" },
        parent: { type: mongoose.Schema.Types.ObjectId, ref: "department", default: null },
        is_active: { type: Boolean, default: true },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("department", DepartmentModel);
module.exports.DEPT_TYPES = DEPT_TYPES;
module.exports.LEAF_TYPES = LEAF_TYPES;

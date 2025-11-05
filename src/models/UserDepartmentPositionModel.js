const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const UserDepartmentPositionModel = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user_info",
            required: true,
        },
        department: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "department",
            required: true,
        },
        position: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "position",
            required: true,
        },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

// Ngăn không cho 1 user có cùng position ở cùng 1 department 2 lần
UserDepartmentPositionModel.index(
    { user: 1, department: 1, position: 1 },
    { unique: true }
);

module.exports = mongoose.model("user_department_position", UserDepartmentPositionModel);

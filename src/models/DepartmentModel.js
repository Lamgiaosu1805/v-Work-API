const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const DepartmentModel = new mongoose.Schema(
    {
        department_name: { type: String, required: true },
        department_code: { type: String, required: true, unique: true },
        description: { type: String, default: "" },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("department", DepartmentModel);

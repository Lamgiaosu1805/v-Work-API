const mongoose = require("mongoose");
const moment = require("moment-timezone");

// BaseSchema — dùng để kế thừa cho các model khác
const BaseSchema = new mongoose.Schema(
  {
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      transform: function (doc, ret) {
        if (ret.createdAt)
          ret.createdAt = moment(ret.createdAt)
            .tz("Asia/Ho_Chi_Minh")
            .format("YYYY-MM-DD HH:mm:ss");
        if (ret.updatedAt)
          ret.updatedAt = moment(ret.updatedAt)
            .tz("Asia/Ho_Chi_Minh")
            .format("YYYY-MM-DD HH:mm:ss");
        return ret;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        if (ret.createdAt)
          ret.createdAt = moment(ret.createdAt)
            .tz("Asia/Ho_Chi_Minh")
            .format("YYYY-MM-DD HH:mm:ss");
        if (ret.updatedAt)
          ret.updatedAt = moment(ret.updatedAt)
            .tz("Asia/Ho_Chi_Minh")
            .format("YYYY-MM-DD HH:mm:ss");
        return ret;
      },
    },
  }
);

module.exports = BaseSchema;

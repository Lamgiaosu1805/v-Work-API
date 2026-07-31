const moment = require("moment-timezone");
const escapeRegExp = require("lodash/escapeRegExp");
const { REQUEST_TYPE_FIELDS } = require("../domain/request.entity");
const { ArgumentInvalidException } = require("../../../core/exceptions/exceptions");

const VALID_TYPES = Object.keys(REQUEST_TYPE_FIELDS);
const TZ = "Asia/Ho_Chi_Minh";

function applyRequestTypeFilter(filter, requestType) {
  if (!requestType) return;
  if (!VALID_TYPES.includes(requestType)) {
    throw new ArgumentInvalidException(`Loại đơn không hợp lệ: ${requestType}`);
  }
  filter.request_type = requestType;
}

function applyDateRangeFilter(filter, from, to) {
  if (!from && !to) return;
  filter.createdAt = {};
  if (from) {
    const fromMoment = moment.tz(from, TZ);
    if (!fromMoment.isValid()) {
      throw new ArgumentInvalidException(`Giá trị "from" không hợp lệ: ${from}`);
    }
    filter.createdAt.$gte = fromMoment.startOf("day").toDate();
  }
  if (to) {
    const toMoment = moment.tz(to, TZ);
    if (!toMoment.isValid()) {
      throw new ArgumentInvalidException(`Giá trị "to" không hợp lệ: ${to}`);
    }
    filter.createdAt.$lte = toMoment.endOf("day").toDate();
  }
}

function buildUserNameSearchFilter(search) {
  const pattern = escapeRegExp(search);
  return {
    isDeleted: false,
    $or: [
      { full_name: { $regex: pattern, $options: "i" } },
      { ma_nv: { $regex: pattern, $options: "i" } }
    ]
  };
}

module.exports = {
  applyRequestTypeFilter,
  applyDateRangeFilter,
  buildUserNameSearchFilter,
  VALID_TYPES
};

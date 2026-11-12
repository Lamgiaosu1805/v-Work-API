import moment from "moment-timezone";
import escapeRegExp from "lodash/escapeRegExp";
import { REQUEST_TYPE_FIELDS } from "../domain/request.entity";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

export const VALID_TYPES = Object.keys(REQUEST_TYPE_FIELDS);
const TZ = "Asia/Ho_Chi_Minh";

export interface RequestFilter {
  request_type?: string;
  createdAt?: { $gte?: Date; $lte?: Date };
  user_id?: unknown;
  [key: string]: unknown;
}

export function applyRequestTypeFilter(filter: RequestFilter, requestType?: string): void {
  if (!requestType) return;
  if (!VALID_TYPES.includes(requestType)) {
    throw new ArgumentInvalidException(`Loại đơn không hợp lệ: ${requestType}`);
  }
  filter.request_type = requestType;
}

export function applyDateRangeFilter(filter: RequestFilter, from?: string, to?: string): void {
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

function parseDayKey(value: string, label: string) {
  const parsed = moment.tz(value, "YYYY-MM-DD", true, TZ);
  if (!parsed.isValid()) {
    throw new ArgumentInvalidException(`Giá trị "${label}" không hợp lệ: ${value}`);
  }
  return parsed;
}

// Lọc đơn có khoảng ngày nghỉ [from_date, to_date] GIAO với [eventFrom, eventTo] (YYYY-MM-DD, tính theo giờ VN).
// Chỉ đơn có from_date/to_date (nghỉ phép, từ xa, công tác, gặp khách) mới khớp; khác với applyDateRangeFilter lọc theo ngày tạo.
export function applyEventDateRangeFilter(
  filter: RequestFilter,
  eventFrom?: string,
  eventTo?: string
): void {
  if (eventFrom) {
    filter.to_date = { $gte: parseDayKey(eventFrom, "event_from").startOf("day").toDate() };
  }
  if (eventTo) {
    filter.from_date = { $lte: parseDayKey(eventTo, "event_to").endOf("day").toDate() };
  }
}

export function buildUserNameSearchFilter(search: string) {
  const pattern = escapeRegExp(search);
  return {
    isDeleted: false,
    $or: [
      { full_name: { $regex: pattern, $options: "i" } },
      { ma_nv: { $regex: pattern, $options: "i" } }
    ]
  };
}

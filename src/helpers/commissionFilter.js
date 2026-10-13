const moment = require("moment-timezone");

const TZ = "Asia/Ho_Chi_Minh";
const DATE_FORMAT = "YYYY-MM-DD";
const COMMISSION_TYPES = ["cif", "ekyc", "investment"];

// ?type=cif,ekyc hoặc ?type=cif&type=ekyc — bỏ trống = tất cả loại
function parseTypes(raw) {
  if (raw === undefined || raw === null || raw === "") return { types: [...COMMISSION_TYPES] };

  const values = []
    .concat(raw)
    .join(",")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const invalid = values.filter((value) => !COMMISSION_TYPES.includes(value));
  if (invalid.length) {
    return {
      error: `Loại hoa hồng không hợp lệ: ${invalid.join(", ")}. Chỉ nhận: ${COMMISSION_TYPES.join(", ")}`
    };
  }
  if (!values.length) return { types: [...COMMISSION_TYPES] };
  return { types: COMMISSION_TYPES.filter((type) => values.includes(type)) };
}

function parseDateRange(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return { range: null };
  if (!dateFrom || !dateTo) {
    return { error: "Cần truyền cả date_from và date_to (định dạng YYYY-MM-DD)" };
  }

  const from = moment.tz(String(dateFrom), DATE_FORMAT, true, TZ);
  const to = moment.tz(String(dateTo), DATE_FORMAT, true, TZ);
  if (!from.isValid() || !to.isValid()) {
    return { error: "date_from và date_to phải có định dạng YYYY-MM-DD" };
  }
  if (from.isAfter(to)) return { error: "date_from phải trước hoặc bằng date_to" };

  return {
    range: {
      from: from.clone().startOf("day").toDate(),
      to: to.clone().endOf("day").toDate(),
      dateFrom: from.format(DATE_FORMAT),
      dateTo: to.format(DATE_FORMAT)
    }
  };
}

function parseMonth(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) return { error: "month phải là số từ 1 đến 12" };
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return { error: "year không hợp lệ" };

  const start = moment.tz({ year: y, month: m - 1, day: 1 }, TZ);
  return { month: m, year: y, from: start.toDate(), to: start.clone().endOf("month").toDate() };
}

/**
 * Bộ lọc dùng chung cho /investments/my-commission và /investments/staff-commission.
 *
 * - Có dateFrom + dateTo (YYYY-MM-DD, tính cả 2 đầu, giờ VN): lọc theo "Ngày ghi nhận" —
 *   invested_at với HH đầu tư, granted_at với HH CIF/eKYC. Khi đó month/year bị bỏ qua.
 * - Không có: lọc theo month/year như cũ. HH đầu tư lọc theo kỳ commission.period_month/period_year
 *   (= tháng của invested_at), CIF/eKYC theo granted_at trong tháng.
 * - type: cif | ekyc | investment, nhiều loại phân tách bằng dấu phẩy. Bỏ trống = tất cả.
 *
 * @param {object} input
 * @param {number|string} input.month  Tháng 1–12 (dùng khi không có dateFrom/dateTo)
 * @param {number|string} input.year   Năm (dùng khi không có dateFrom/dateTo)
 * @param {string} [input.dateFrom]    YYYY-MM-DD
 * @param {string} [input.dateTo]      YYYY-MM-DD
 * @param {string|string[]} [input.type]
 * @returns {{ error: string } | {
 *   types: string[], from: Date, to: Date, period: object, investmentMatch: object
 * }}
 */
function parseCommissionFilter({ month, year, dateFrom, dateTo, type }) {
  const typeResult = parseTypes(type);
  if (typeResult.error) return { error: typeResult.error };

  const rangeResult = parseDateRange(dateFrom, dateTo);
  if (rangeResult.error) return { error: rangeResult.error };

  const { types } = typeResult;
  const { range } = rangeResult;
  if (range) {
    return {
      types,
      from: range.from,
      to: range.to,
      period: { date_from: range.dateFrom, date_to: range.dateTo },
      investmentMatch: { invested_at: { $gte: range.from, $lte: range.to } }
    };
  }

  const monthResult = parseMonth(month, year);
  if (monthResult.error) return { error: monthResult.error };
  return {
    types,
    from: monthResult.from,
    to: monthResult.to,
    period: { month: monthResult.month, year: monthResult.year },
    investmentMatch: {
      "commission.period_month": monthResult.month,
      "commission.period_year": monthResult.year
    }
  };
}

module.exports = { parseCommissionFilter, COMMISSION_TYPES };

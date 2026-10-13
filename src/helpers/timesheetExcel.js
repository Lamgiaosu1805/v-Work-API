const ExcelJS = require("exceljs");
const moment = require("moment-timezone");

const TZ = "Asia/Ho_Chi_Minh";

// CTV có chức vụ đúng "CTV" không chấm công theo ngày — HR tính cố định 12 công/kỳ (theo file mẫu)
const CTV_POSITION_NAME = "ctv";
const CTV_FIXED_WORK_UNITS = 12;

const LEGEND = [
  "X: Ngày công thực tế, đi làm đầy đủ và đúng giờ (1 công)",
  "V: Làm nửa ngày (0,5 công)",
  "H: Làm nửa ngày (nửa ngày tính phép) (1 công, 0,5 phép)",
  "P: Ngày nghỉ hưởng nguyên lương (1 công)",
  "K: Nghỉ không lương (0 công)",
  "R: Làm remote, tính full lương (1 công)",
  "A: Làm cả ngày (1,5 công)",
  "L: Nghỉ lễ"
];

const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

// Công tác / gặp khách hàng tính như ngày đi làm (ký hiệu X); vắng không phép ghi K như nghỉ không lương
const WORK_STATUSES = new Set(["present", "missed_clock", "business_trip", "client_visit"]);
const UNPAID_STATUSES = new Set(["leave_unpaid", "absent"]);

function codeByWorkUnit(workUnit) {
  if (workUnit >= 1.5) return "A";
  if (workUnit >= 1) return "X";
  if (workUnit >= 0.5) return "V";
  return "";
}

/**
 * Ký hiệu chấm công của 1 ngày (X, V, H, P, K, R, A, L hoặc "" nếu không đi làm / chưa chốt công).
 * @param {{ work_unit: number|null, statuses: Array<{ status: string }>, is_holiday: boolean }} day
 */
function resolveDayCode({ work_unit: workUnit, statuses = [], is_holiday: isHoliday }) {
  const kinds = statuses.map((s) => s.status).filter((status) => status !== "pending");
  const hasWork = kinds.some((status) => WORK_STATUSES.has(status));
  const hasRemote = kinds.includes("remote");
  const hasPaidLeave = kinds.includes("leave_paid");
  const hasUnpaid = kinds.some((status) => UNPAID_STATUSES.has(status));

  if (isHoliday && !hasWork && !hasRemote) return "L";
  // Chưa có trạng thái (ngày chưa chốt, hoặc công được sửa tay) → dựa vào số công
  if (!kinds.length) return codeByWorkUnit(workUnit ?? 0);
  if (hasRemote && !hasWork && !hasPaidLeave && !hasUnpaid) return "R";
  if (hasPaidLeave) return hasWork || hasRemote ? "H" : "P";
  if (hasWork || hasRemote) {
    if (workUnit === null || workUnit === undefined) return ""; // chưa chốt công trong ngày
    return codeByWorkUnit(workUnit) || "K";
  }
  if (hasUnpaid) return "K";
  return "";
}

function isFixedCtv(positionNames) {
  return (
    positionNames.length > 0 &&
    positionNames.every((name) => (name || "").trim().toLowerCase() === CTV_POSITION_NAME)
  );
}

function blankIfZero(value) {
  return value || null;
}

/**
 * Số liệu 1 dòng bảng công. "Số công thực tế" giữ đúng công thức file xuất cũ: tổng công trừ nghỉ
 * phép, công tác và gặp khách hàng (remote vẫn tính là đi làm).
 */
function buildEmployeeLine({ row, departmentNames, positionNames }, periodDays) {
  const base = {
    fullName: row.full_name,
    department: departmentNames.join(", "),
    position: positionNames.join(", ")
  };

  if (isFixedCtv(positionNames)) {
    return {
      ...base,
      codes: periodDays.map(() => ""),
      totals: [CTV_FIXED_WORK_UNITS, 0, CTV_FIXED_WORK_UNITS, null, 0],
      penalty: null,
      missedClock: null
    };
  }

  const awayDays = (row.business_trip_days ?? 0) + (row.client_visit_days ?? 0);
  const actual = row.work_unit_total - (row.leave_paid_days ?? 0) - awayDays;
  return {
    ...base,
    codes: periodDays.map(({ key }) =>
      row.daily.has(key) ? resolveDayCode(row.daily.get(key)) : ""
    ),
    totals: [
      row.work_unit_total,
      actual,
      row.work_unit_official,
      blankIfZero(row.work_unit_probation),
      row.leave_paid_days ?? 0
    ],
    penalty: blankIfZero(row.penalty_amount_total),
    missedClock: blankIfZero(row.missed_clock_days)
  };
}

const FONT = { name: "Times New Roman", size: 11 };
const THIN = { style: "thin" };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const SUNDAY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
const CENTER = { horizontal: "center", vertical: "middle", wrapText: true };

const HEADER_ROW = 10; // dòng 1–8 là tiêu đề + chú thích, dòng 10–12 là header bảng
const FIXED_COLS = 4; // TT, Họ và tên, Đơn vị, Chức vụ
const TOTAL_HEADERS = [
  "Tổng công",
  "Số công thực tế",
  "Công chính thức",
  "Công thử việc",
  "Nghỉ phép"
];

/**
 * Dựng file Excel "Bảng chấm công" theo mẫu sheet Tổng công của HR.
 *
 * @param {object} input
 * @param {number} input.month
 * @param {number} input.year
 * @param {moment.Moment} input.periodStart
 * @param {moment.Moment} input.periodEnd
 * @param {number} input.standardWorkUnits   Định mức ngày công của kỳ
 * @param {string} [input.departmentName]    "Bộ phận chấm công" khi xuất theo 1 phòng ban
 * @param {Array<{ row: object, departmentNames: string[], positionNames: string[] }>} input.employees
 *        row = kết quả buildPayrollRows(..., includeDaily: true)
 * @returns {ExcelJS.Workbook}
 */
function buildTimesheetWorkbook({
  month,
  year,
  periodStart,
  periodEnd,
  standardWorkUnits,
  departmentName = "",
  employees
}) {
  const periodDays = [];
  const cursor = moment.tz(periodStart, TZ).startOf("day");
  while (cursor.isSameOrBefore(periodEnd, "day")) {
    periodDays.push({
      key: cursor.format("YYYY-MM-DD"),
      dayLabel: cursor.format("DD"),
      weekday: cursor.day()
    });
    cursor.add(1, "day");
  }

  const firstDayCol = FIXED_COLS + 1;
  const lastDayCol = FIXED_COLS + periodDays.length;
  const firstTotalCol = lastDayCol + 1;
  const penaltyCol = firstTotalCol + TOTAL_HEADERS.length;
  const missedClockCol = penaltyCol + 1;
  const lastCol = missedClockCol;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tổng công", {
    views: [{ state: "frozen", xSplit: FIXED_COLS, ySplit: HEADER_ROW + 2 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    }
  });

  sheet.columns = [
    { width: 5 },
    { width: 26 },
    { width: 20 },
    { width: 26 },
    ...periodDays.map(() => ({ width: 4.3 })),
    { width: 8 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 8 },
    { width: 12 },
    { width: 9 }
  ];

  // ── Tiêu đề + chú thích ký hiệu ─────────────────────────────────────────
  const setCell = (rowNumber, col, value, style = {}) => {
    const cell = sheet.getCell(rowNumber, col);
    cell.value = value;
    cell.font = { ...FONT, ...(style.font || {}) };
    if (style.alignment) cell.alignment = style.alignment;
    return cell;
  };

  setCell(2, 2, `BẢNG CHẤM CÔNG THÁNG ${String(month).padStart(2, "0")}/${year}`, {
    font: { bold: true, size: 14 }
  });
  setCell(3, 2, "Từ ngày");
  setCell(3, 3, moment.tz(periodStart, TZ).format("DD/MM/YYYY"));
  setCell(3, 4, `Đến ngày: ${moment.tz(periodEnd, TZ).format("DD/MM/YYYY")}`);
  setCell(4, 2, "Bộ phận chấm công");
  setCell(4, 3, departmentName);
  setCell(5, 2, "Định mức ngày công");
  setCell(5, 3, standardWorkUnits ?? null, { alignment: { horizontal: "left" } });

  const legendLastCol = Math.min(firstDayCol + 15, lastCol);
  LEGEND.forEach((text, index) => {
    const rowNumber = index + 1;
    sheet.mergeCells(rowNumber, firstDayCol, rowNumber, legendLastCol);
    setCell(rowNumber, firstDayCol, text, { font: { italic: true } });
  });

  // ── Header bảng (3 dòng) ────────────────────────────────────────────────
  const headerCell = (row1, col1, row2, col2, value) => {
    if (row1 !== row2 || col1 !== col2) sheet.mergeCells(row1, col1, row2, col2);
    const cell = setCell(row1, col1, value, { font: { bold: true }, alignment: CENTER });
    cell.fill = HEADER_FILL;
  };

  const h1 = HEADER_ROW;
  const h2 = HEADER_ROW + 1;
  const h3 = HEADER_ROW + 2;
  ["TT", "Họ và tên", "Đơn vị", "Chức vụ"].forEach((label, index) => {
    headerCell(h1, index + 1, h3, index + 1, label);
  });
  headerCell(h1, firstDayCol, h1, lastDayCol, "Ngày công trong tháng");
  headerCell(h1, firstTotalCol, h1, penaltyCol - 1, "Tính công");
  headerCell(h1, penaltyCol, h3, penaltyCol, "Phạt đi muộn, về sớm");
  headerCell(h1, missedClockCol, h3, missedClockCol, "Quên chấm công");
  TOTAL_HEADERS.forEach((label, index) => {
    headerCell(h2, firstTotalCol + index, h3, firstTotalCol + index, label);
  });
  periodDays.forEach((day, index) => {
    const col = firstDayCol + index;
    headerCell(h2, col, h2, col, day.dayLabel);
    headerCell(h3, col, h3, col, WEEKDAY_LABELS[day.weekday]);
  });
  sheet.getRow(h1).height = 20;
  sheet.getRow(h2).height = 30;
  sheet.getRow(h3).height = 18;

  // ── Dữ liệu ─────────────────────────────────────────────────────────────
  const lines = employees.map((employee) => buildEmployeeLine(employee, periodDays));
  lines.forEach((line, index) => {
    const rowNumber = h3 + 1 + index;
    const values = [
      index + 1,
      line.fullName,
      line.department,
      line.position,
      ...line.codes,
      ...line.totals,
      line.penalty,
      line.missedClock
    ];
    values.forEach((value, valueIndex) => {
      const col = valueIndex + 1;
      const isTextCol = col >= 2 && col <= FIXED_COLS;
      const cell = setCell(rowNumber, col, value === "" ? null : value, {
        alignment: isTextCol
          ? { vertical: "middle", wrapText: true }
          : { horizontal: "center", vertical: "middle" }
      });
      cell.border = BORDER;
      if (col >= firstDayCol && col <= lastDayCol && periodDays[col - firstDayCol].weekday === 0) {
        cell.fill = SUNDAY_FILL;
      }
      if (col === penaltyCol) cell.numFmt = "#,##0";
    });
  });

  // Viền cho header (merge cell chỉ giữ style ô đầu → kẻ viền cho từng ô)
  for (let rowNumber = h1; rowNumber <= h3; rowNumber++) {
    for (let col = 1; col <= lastCol; col++) {
      sheet.getCell(rowNumber, col).border = BORDER;
    }
  }

  // ── Ký tên (để trống, ký tay) ───────────────────────────────────────────
  const signRow = h3 + lines.length + 4;
  const signBlocks = [
    { label: "Người lập công", from: firstDayCol + 1, to: firstDayCol + 9 },
    { label: "Phòng HCNS", from: Math.max(lastDayCol - 8, firstDayCol + 11), to: lastDayCol }
  ];
  signBlocks.forEach(({ label, from, to }) => {
    sheet.mergeCells(signRow, from, signRow, to);
    setCell(signRow, from, label, { font: { bold: true }, alignment: CENTER });
    sheet.mergeCells(signRow + 1, from, signRow + 1, to);
    setCell(signRow + 1, from, "(Ký, ghi rõ họ tên)", {
      font: { italic: true },
      alignment: CENTER
    });
  });

  return workbook;
}

module.exports = {
  buildTimesheetWorkbook,
  resolveDayCode,
  isFixedCtv,
  CTV_FIXED_WORK_UNITS
};

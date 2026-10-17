import xlsx from "xlsx";

const EMPLOYEE_HEADER_REGEX = /Mã nhân viên:\s*(\S+)/;
const TEXT_DATE_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TIME_REGEX = /^\d{2}:\d{2}/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

// Nhãn cột "Thứ" (cột 1) của file máy chấm công -> Date#getUTCDay() (0 = Chủ nhật)
const WEEKDAY_BY_LABEL = new Map<string, number>([
  ["cn", 0],
  ["chủ nhật", 0],
  ["hai", 1],
  ["ba", 2],
  ["tư", 3],
  ["năm", 4],
  ["sáu", 5],
  ["bảy", 6]
]);

type DateParts = { day: number; month: number; year: number };
type TextDateOrder = "DMY" | "MDY";

export function parseExcelToBlocks(buffer: Buffer) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const headers: { machine_code: string; startRow: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const match = String(rows[i][0] || "").match(EMPLOYEE_HEADER_REGEX);
    if (match) headers.push({ machine_code: match[1], startRow: i });
  }

  return headers.map((h, idx) => {
    const nextStart = idx + 1 < headers.length ? headers[idx + 1].startRow : rows.length;
    return {
      machine_code: h.machine_code,
      rows: rows.slice(h.startRow + 1, nextStart)
    };
  });
}

// Bug thật phát hiện (user báo giờ check-in bị "giữ nguyên giá trị cũ" sau import): 1 số máy chấm công
// xuất Excel với cell giờ được ĐỊNH DẠNG KIỂU TIME THẬT (không phải text) khi ngày đó có ĐỦ CẢ vào lẫn
// ra — SheetJS đọc cell này ra số thô (phân số của 1 ngày, vd 0.2958333... = 07:06), KHÔNG phải chuỗi
// "07:06". Cell chỉ có ĐÚNG 1 lần quét trong ngày (vd "17:40") lại thường ở dạng text bình thường. Regex
// cũ chỉ nhận chuỗi "HH:mm" nên bỏ sót toàn bộ các ngày dạng số — coi như ô trống, cả ngày bị skip,
// giữ nguyên dữ liệu cũ trong DB mà không báo lỗi gì. Verify thật bằng file Excel thật của user.
function extractTimeString(value: unknown): string | null {
  if (typeof value === "number") {
    if (value < 0 || value >= 1) return null; // chỉ nhận giờ-trong-ngày (không kèm phần ngày)
    const totalMinutes = Math.round(value * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const trimmed = String(value ?? "").trim();
  return TIME_REGEX.test(trimmed) ? trimmed.slice(0, 5) : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function isValidDate({ day, month, year }: DateParts) {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf({ day, month, year }: DateParts) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function parseWeekdayLabel(value: unknown): number | null {
  const label = String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
  return WEEKDAY_BY_LABEL.get(label) ?? null;
}

// Ngày hợp lệ và (nếu dòng có cột "Thứ") khớp đúng thứ trong tuần
function isConsistentDate(parts: DateParts, weekday: number | null) {
  return isValidDate(parts) && (weekday === null || weekdayOf(parts) === weekday);
}

function matchTextDate(value: unknown) {
  const match = String(value ?? "")
    .trim()
    .match(TEXT_DATE_REGEX);
  if (!match) return null;
  const [first, second, year] = match.slice(1).map(Number);
  return {
    dmy: { day: first, month: second, year },
    mdy: { day: second, month: first, year }
  };
}

// Bug thật (file "ChiTietTungNguoiTungNgay" 16/10/2026): phần mềm máy chấm công ghi ngày thành CHUỖI
// theo định dạng ngày ngắn của Windows máy xuất file — máy để vùng English (US) ra "10/8/2026"
// (tháng/ngày), máy để tiếng Việt ra "08/10/2026". Regex cũ chỉ nhận DD/MM/YYYY nên "10/8" bị bỏ,
// "10/12" đọc nhầm thành 10/12, "10/13" thành ngày lỗi làm hỏng cả block -> import 0 ngày, không báo
// lỗi. Chốt 1 thứ tự cho cả block theo bằng chứng không mơ hồ: chỉ 1 cách đọc ra ngày hợp lệ (vd số
// > 12 chỉ có thể là ngày) hoặc chỉ 1 cách đọc khớp cột "Thứ". Không có bằng chứng -> ngày/tháng.
function detectTextDateOrder(rows: any[][]): TextDateOrder {
  let dmyVotes = 0;
  let mdyVotes = 0;
  for (const row of rows) {
    const candidates = matchTextDate(row[0]);
    if (!candidates) continue;
    const weekday = parseWeekdayLabel(row[1]);
    const dmyOk = isConsistentDate(candidates.dmy, weekday);
    const mdyOk = isConsistentDate(candidates.mdy, weekday);
    if (dmyOk && !mdyOk) dmyVotes++;
    else if (mdyOk && !dmyOk) mdyVotes++;
  }
  return mdyVotes > dmyVotes ? "MDY" : "DMY";
}

// Cell ngày có thể là chuỗi (DD/MM/YYYY hoặc M/D/YYYY, xem detectTextDateOrder) hoặc NGÀY THẬT của
// Excel (vd user sửa tay cột ngày trong Excel) — SheetJS đọc ra số serial (46303 = 08/10/2026).
// Trả về chuỗi DD/MM/YYYY chuẩn; ngày lỗi/ngoài phạm vi/lệch cột "Thứ" -> null (bỏ dòng, không import
// nhầm sang ngày khác).
function normalizeDateCell(
  value: unknown,
  weekdayValue: unknown,
  textDateOrder: TextDateOrder
): string | null {
  let parts: DateParts | null = null;
  if (typeof value === "number") {
    if (value >= 1) {
      const parsed = xlsx.SSF.parse_date_code(Math.floor(value));
      if (parsed) parts = { day: parsed.d, month: parsed.m, year: parsed.y };
    }
  } else {
    const candidates = matchTextDate(value);
    if (candidates) parts = textDateOrder === "DMY" ? candidates.dmy : candidates.mdy;
  }
  if (!parts || !isConsistentDate(parts, parseWeekdayLabel(weekdayValue))) return null;
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

export function parseDayRows(block: { rows: any[][] }) {
  const dayRows: { dateStr: string; rawIn: string | null; rawOut: string | null }[] = [];
  const textDateOrder = detectTextDateOrder(block.rows);
  for (const row of block.rows) {
    const dateStr = normalizeDateCell(row[0], row[1], textDateOrder);
    if (!dateStr) continue;
    const inCell = [row[2], row[4], row[6]].map(extractTimeString).find((v) => v !== null) ?? null;
    const outCell = [row[7], row[5], row[3]].map(extractTimeString).find((v) => v !== null) ?? null;
    dayRows.push({ dateStr, rawIn: inCell, rawOut: outCell });
  }
  return dayRows;
}

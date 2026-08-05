import xlsx from "xlsx";

const EMPLOYEE_HEADER_REGEX = /Mã nhân viên:\s*(\S+)/;
const DATE_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;
const TIME_REGEX = /^\d{2}:\d{2}/;

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

export function parseDayRows(block: { rows: any[][] }) {
  const dayRows: { dateStr: string; rawIn: string | null; rawOut: string | null }[] = [];
  for (const row of block.rows) {
    const dateStr = String(row[0] || "").trim();
    if (!DATE_REGEX.test(dateStr)) continue;
    const inCell = [row[2], row[4], row[6]].map(extractTimeString).find((v) => v !== null) ?? null;
    const outCell = [row[7], row[5], row[3]].map(extractTimeString).find((v) => v !== null) ?? null;
    dayRows.push({ dateStr, rawIn: inCell, rawOut: outCell });
  }
  return dayRows;
}

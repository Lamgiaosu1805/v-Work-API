import xlsx from "xlsx";
import {
  parseExcelToBlocks,
  parseDayRows
} from "../../../src/modules/attendance/infrastructure/excel-attendance-parser";

function buildBuffer(aoa: string[][]): Buffer {
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseExcelToBlocks", () => {
  test("tách đúng nhiều block theo header 'Mã nhân viên: X'", () => {
    const buffer = buildBuffer([
      ["Mã nhân viên: M001", "", "", "", "", "", "", ""],
      ["01/07/2026", "", "08:01", "", "", "", "", "17:31"],
      ["Mã nhân viên: M002", "", "", "", "", "", "", ""],
      ["02/07/2026", "", "09:00", "", "", "", "", "18:00"]
    ]);

    const blocks = parseExcelToBlocks(buffer);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].machine_code).toBe("M001");
    expect(blocks[0].rows).toHaveLength(1);
    expect(blocks[1].machine_code).toBe("M002");
    expect(blocks[1].rows).toHaveLength(1);
  });

  test("block cuối cùng lấy hết phần còn lại của sheet", () => {
    const buffer = buildBuffer([
      ["Mã nhân viên: M001", "", "", "", "", "", "", ""],
      ["01/07/2026", "", "08:01", "", "", "", "", "17:31"],
      ["02/07/2026", "", "08:02", "", "", "", "", "17:32"],
      ["03/07/2026", "", "08:03", "", "", "", "", "17:33"]
    ]);

    const blocks = parseExcelToBlocks(buffer);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].rows).toHaveLength(3);
  });

  test("không có header nào khớp: trả về mảng rỗng", () => {
    const buffer = buildBuffer([["01/07/2026", "", "08:01"]]);

    expect(parseExcelToBlocks(buffer)).toEqual([]);
  });
});

describe("parseDayRows", () => {
  test("bỏ qua dòng không đúng định dạng ngày DD/MM/YYYY", () => {
    const rows = parseDayRows({
      rows: [
        ["không phải ngày", "", "08:01", "", "", "", "", "17:31"],
        ["01/07/2026", "", "08:01", "", "", "", "", "17:31"]
      ]
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].dateStr).toBe("01/07/2026");
  });

  test("lấy đúng rawIn từ row[2]/row[4]/row[6] và rawOut từ row[7]/row[5]/row[3]", () => {
    const rows = parseDayRows({
      rows: [["01/07/2026", "", "08:01", "", "", "", "", "17:31"]]
    });

    expect(rows[0].rawIn).toBe("08:01");
    expect(rows[0].rawOut).toBe("17:31");
  });

  test("cắt giờ về đúng 5 ký tự HH:mm (bỏ giây nếu có)", () => {
    const rows = parseDayRows({
      rows: [["01/07/2026", "", "08:01:30", "", "", "", "", "17:31:45"]]
    });

    expect(rows[0].rawIn).toBe("08:01");
    expect(rows[0].rawOut).toBe("17:31");
  });

  test("không có ô nào khớp định dạng giờ: rawIn/rawOut đều null", () => {
    const rows = parseDayRows({
      rows: [["01/07/2026", "", "", "", "", "", "", ""]]
    });

    expect(rows[0].rawIn).toBeNull();
    expect(rows[0].rawOut).toBeNull();
  });

  // Bug thật phát hiện qua báo cáo user + file Excel thật (mã 0038, ngày 26/05/2026): 1 số máy chấm
  // công xuất cell giờ dưới dạng SỐ THÔ kiểu Time thật của Excel (phân số của 1 ngày) khi ngày có đủ
  // cả vào/ra, thay vì chuỗi "HH:mm" — regex cũ bỏ sót hoàn toàn, cả ngày bị coi như trống -> import
  // skip, giữ nguyên giá trị cũ trong DB không báo lỗi. Giá trị test lấy đúng từ file thật của user:
  // 0.29583333333333334 = 07:06, 0.7090277777777778 = 17:01 (đã verify bằng node -e thủ công).
  test("nhận diện được cell giờ dạng số thô kiểu Time của Excel (không chỉ chuỗi HH:mm)", () => {
    const rows = parseDayRows({
      rows: [["26/05/2026", "Ba", 0.29583333333333334, 0.7090277777777778, "", "", "", ""]]
    });

    expect(rows[0].rawIn).toBe("07:06");
    expect(rows[0].rawOut).toBe("17:01");
  });

  test("cell giờ dạng số thô nhưng chỉ có 1 lần quét (ở row[3], nhóm out): vẫn nhận diện đúng", () => {
    const rows = parseDayRows({
      rows: [["01/07/2026", "", "", 0.7375, "", "", "", ""]] // 0.7375 * 1440 = 1062 phút = 17:42
    });

    expect(rows[0].rawIn).toBeNull();
    expect(rows[0].rawOut).toBe("17:42");
  });

  test("giá trị số ngoài phạm vi giờ-trong-ngày (>= 1, có phần ngày kèm theo): bỏ qua, không nhận nhầm", () => {
    const rows = parseDayRows({
      rows: [["01/07/2026", "", 45678.5, "", "", "", "", ""]]
    });

    expect(rows[0].rawIn).toBeNull();
  });

  // Bug nghiệp vụ có sẵn (KHÔNG sửa ở đây, xem note task 1.8.4.5 trong
  // docs/DDD-HEXAGONAL-MIGRATION-PLAN.md): khi chỉ có ĐÚNG 1 lần quét trong ngày, việc phân loại
  // in/out theo vị trí cột cố định có thể sai nếu quét đó thực chất thuộc phía ngược lại — test này
  // khoá lại đúng hành vi HIỆN TẠI (đã port nguyên trạng), không phải hành vi đã được xác nhận đúng.
  test("hành vi hiện tại — chỉ 1 giờ quét ở row[3] (nhóm out): luôn coi là rawOut dù bản chất là giờ vào sáng", () => {
    const rows = parseDayRows({
      rows: [["01/07/2026", "", "", "08:01", "", "", "", ""]]
    });

    expect(rows[0].rawIn).toBeNull();
    expect(rows[0].rawOut).toBe("08:01");
  });
});

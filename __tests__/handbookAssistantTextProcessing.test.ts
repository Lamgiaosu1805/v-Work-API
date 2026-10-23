import {
  cleanExtractedPages,
  splitArticles,
  parseManifest,
  defaultArticleLabel,
  HandbookAssistantError,
  isHandbookAssistantError
} from "../src/modules/handbook-assistant";
import { ArgumentInvalidException } from "../src/core/exceptions/exceptions";

describe("cleanExtractedPages", () => {
  it("bỏ số trang, giữ nguyên nội dung", () => {
    const text = cleanExtractedPages([
      "Điều 1. A\nNội dung\n- 1 -",
      "Điều 2. B\nTrang 2/5\nNội dung 2"
    ]);
    expect(text).toBe("Điều 1. A\nNội dung\nĐiều 2. B\nNội dung 2");
  });

  it("bỏ header/footer lặp ở ít nhất một nửa số trang (không phụ thuộc số trang)", () => {
    const pages = [1, 2, 3, 4].map(
      (n) =>
        `CÔNG TY CP CÔNG NGHỆ TÀI CHÍNH VNFITE\nNội dung đoạn ${n}\nNội quy lao động - Trang ${n}`
    );
    const text = cleanExtractedPages(pages);
    expect(text).not.toContain("VNFITE");
    expect(text).not.toContain("Nội quy lao động - Trang");
    expect(text).toContain("Nội dung đoạn 1");
    expect(text).toContain("Nội dung đoạn 4");
  });

  it("không xoá nhầm dòng chỉ khác chữ số như 'Điều N' đứng riêng một dòng ở mỗi trang", () => {
    const pages = [1, 2, 3, 4, 5].map((n) => `Điều ${n}\nNội dung của điều ${n}`);
    expect(cleanExtractedPages(pages).split("\n")).toEqual(
      [1, 2, 3, 4, 5].flatMap((n) => [`Điều ${n}`, `Nội dung của điều ${n}`])
    );
  });

  it("bỏ dòng lặp giống hệt (header) nhưng giữ dòng nội dung chỉ khác chữ số", () => {
    const pages = [1, 2, 3, 4].map((n) => `QUY CHẾ NỘI BỘ\nNội dung đoạn ${n}`);
    expect(cleanExtractedPages(pages).split("\n")).toEqual([
      "Nội dung đoạn 1",
      "Nội dung đoạn 2",
      "Nội dung đoạn 3",
      "Nội dung đoạn 4"
    ]);
  });

  it("không bỏ dòng lặp khi tài liệu dưới 3 trang", () => {
    const text = cleanExtractedPages(["Dòng lặp\nA", "Dòng lặp\nB"]);
    expect(text).toBe("Dòng lặp\nA\nDòng lặp\nB");
  });

  it("chuẩn hoá NFC, bỏ ký tự vô hình và gộp khoảng trắng", () => {
    const decomposed = "Điều".normalize("NFD");
    const zeroWidth = String.fromCharCode(0x200b);
    const softHyphen = String.fromCharCode(0x00ad);
    const nbsp = String.fromCharCode(0x00a0);
    const text = cleanExtractedPages([
      `${decomposed}${zeroWidth} 7.${nbsp}${nbsp}Thời${softHyphen} giờ\t  làm việc`
    ]);
    expect(text).toBe("Điều 7. Thời giờ làm việc");
    expect(text).toBe(text.normalize("NFC"));
  });

  it("nén nhiều dòng trống liên tiếp", () => {
    expect(cleanExtractedPages(["A\n\n\n\n\nB"])).toBe("A\n\nB");
  });
});

describe("splitArticles", () => {
  const sample = [
    "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
    "Căn cứ Bộ luật Lao động.",
    "",
    "Chương II",
    "THỜI GIỜ LÀM VIỆC, THỜI GIỜ NGHỈ NGƠI",
    "Điều 7. Thời giờ làm việc",
    "1. Thời giờ làm việc từ Thứ Hai đến Thứ Sáu:",
    "a) Buổi sáng: từ 08h00 đến 12h00;",
    "b) Buổi chiều: từ 13h30 đến 17h30.",
    "2. Thứ Bảy làm việc buổi sáng theo lịch luân",
    "phiên do Trưởng phòng sắp xếp.",
    "Điều 8. Chấm công",
    "1. Người lao động chấm công trên vWork.",
    "2. Trường hợp quên chấm công, tạo đơn giải trình theo quy định tại",
    "Điều 7 của Nội quy này và được quản lý xác nhận."
  ].join("\n");

  it("tách Điều, khoản, điểm; nối dòng bị ngắt; gắn chương", () => {
    const { articles, preamble, warnings } = splitArticles(sample);

    expect(preamble).toEqual(["CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Căn cứ Bộ luật Lao động."]);
    expect(articles.map((a) => a.articleIdx)).toEqual([7, 8]);
    expect(articles[0].title).toBe("Điều 7. Thời giờ làm việc");
    expect(articles[0].chapter).toBe("Chương II. THỜI GIỜ LÀM VIỆC, THỜI GIỜ NGHỈ NGƠI");
    expect(articles[0].blocks).toEqual([
      "1. Thời giờ làm việc từ Thứ Hai đến Thứ Sáu:",
      "a) Buổi sáng: từ 08h00 đến 12h00;",
      "b) Buổi chiều: từ 13h30 đến 17h30.",
      "2. Thứ Bảy làm việc buổi sáng theo lịch luân phiên do Trưởng phòng sắp xếp."
    ]);
    // "Điều 7 của Nội quy này..." đầu dòng là tham chiếu, được nối vào khoản 2 của Điều 8
    expect(articles[1].blocks).toEqual([
      "1. Người lao động chấm công trên vWork.",
      "2. Trường hợp quên chấm công, tạo đơn giải trình theo quy định tại Điều 7 của Nội quy này và được quản lý xác nhận."
    ]);
    expect(warnings).toEqual([]);
  });

  it("nhận tiêu đề viết hoa/viết thường, Unicode dựng sẵn hay tổ hợp", () => {
    const decomposed = "Điều 3. Nghỉ lễ".normalize("NFD");
    const { articles } = splitArticles(`ĐIỀU 1: Phạm vi\nNội dung 1\n${decomposed}\nNội dung 3`);
    expect(articles.map((a) => a.title)).toEqual(["Điều 1. Phạm vi", "Điều 3. Nghỉ lễ"]);
  });

  it("lấy tiêu đề ở dòng kế tiếp khi dòng Điều chỉ có số", () => {
    const { articles } = splitArticles("Điều 4\nNghỉ phép năm\n1. Mười hai ngày.");
    expect(articles[0].title).toBe("Điều 4. Nghỉ phép năm");
    expect(articles[0].blocks).toEqual(["1. Mười hai ngày."]);
  });

  it("không coi 'Điều N' đứng một mình mà dòng sau viết thường là tiêu đề", () => {
    const { articles } = splitArticles(
      "Điều 5. Chấm công\n1. Thực hiện theo quy định tại\nĐiều 6\nnày và các văn bản liên quan."
    );
    expect(articles).toHaveLength(1);
    expect(articles[0].blocks).toEqual([
      "1. Thực hiện theo quy định tại Điều 6 này và các văn bản liên quan."
    ]);
  });

  it("không có tiêu đề thì tiêu đề chỉ là 'Điều N'", () => {
    const { articles } = splitArticles("Điều 9\n1. Nội dung.");
    expect(articles[0].title).toBe("Điều 9");
  });

  it("báo cảnh báo khi thiếu Điều, số Điều giảm, Điều rỗng; giữ dòng giảm làm nội dung", () => {
    const { articles, warnings } = splitArticles(
      ["Điều 1. A", "1. x", "Điều 4. B", "1. y", "Điều 2. Lạc chỗ", "Điều 6. C"].join("\n")
    );
    expect(articles.map((a) => a.articleIdx)).toEqual([1, 4, 6]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Thiếu Điều 2–3"),
        expect.stringContaining("không lớn hơn Điều 4"),
        expect.stringContaining("Thiếu Điều 5"),
        expect.stringContaining("Điều 6. C không có nội dung")
      ])
    );
    expect(articles[1].blocks).toEqual(["1. y Điều 2. Lạc chỗ"]);
  });

  it("dòng trống giữa câu (ngắt trang) là nối tiếp, sau câu đã kết thúc là đoạn mới", () => {
    const { articles } = splitArticles(
      "Điều 1. A\n1. Người lao động phải tuân thủ\n\nđúng giờ giấc.\n\nNgoài ra còn phải ký cam kết."
    );
    expect(articles[0].blocks).toEqual([
      "1. Người lao động phải tuân thủ đúng giờ giấc.",
      "Ngoài ra còn phải ký cam kết."
    ]);
  });

  it("gạch đầu dòng là từng khối riêng; đoạn dẫn nhập trước khoản được giữ", () => {
    const { articles } = splitArticles(
      "Điều 1. Bậc phạt\nÁp dụng như sau:\n- Lần 1: nhắc nhở.\n- Lần 2: trừ thưởng."
    );
    expect(articles[0].blocks).toEqual([
      "Áp dụng như sau:",
      "- Lần 1: nhắc nhở.",
      "- Lần 2: trừ thưởng."
    ]);
  });

  it("khoản đánh số theo Điều (5.1.) là từng khối riêng, kể cả khi dính liền chữ; số thập phân đầu dòng không phải khoản", () => {
    const { articles, warnings } = splitArticles(
      [
        "Điều 5. Thời giờ làm việc bình thường",
        "5.1. Khối văn phòng làm việc 38,5 giờ trong một",
        "tuần theo lịch sau.",
        "5.2.Thời gian nghỉ trưa không tính vào thời giờ làm việc.",
        "Điều 6. Nghỉ hằng năm",
        "6.3. Phần thập phân được làm tròn: từ",
        "0.5 ngày trở lên tính tròn 01 ngày.",
        "6.10. Khoản hai chữ số."
      ].join("\n")
    );
    expect(articles[0].blocks).toEqual([
      "5.1. Khối văn phòng làm việc 38,5 giờ trong một tuần theo lịch sau.",
      "5.2.Thời gian nghỉ trưa không tính vào thời giờ làm việc."
    ]);
    expect(articles[1].blocks).toEqual([
      "6.3. Phần thập phân được làm tròn: từ 0.5 ngày trở lên tính tròn 01 ngày.",
      "6.10. Khoản hai chữ số."
    ]);
    expect(warnings).toEqual([]);
  });

  it("văn bản không có Điều nào → cảnh báo", () => {
    const { articles, warnings } = splitArticles("Chỉ là một đoạn văn.");
    expect(articles).toEqual([]);
    expect(warnings).toEqual(["Không tìm thấy tiêu đề Điều nào trong văn bản"]);
  });
});

describe("parseManifest", () => {
  const valid = () => ({
    documents: [
      {
        documentCode: "NOI_QUY",
        documentTitle: "Nội quy lao động",
        shortName: "Nội quy",
        articles: [
          { articleIdx: 8, title: "Điều 8. Chấm công", blocks: ["1. A"] },
          { articleIdx: 7, title: "Điều 7. Giờ làm", blocks: ["1. B", "2. C"], label: "Nhãn riêng" }
        ]
      }
    ],
    suggestions: ["Câu gợi ý?"]
  });

  it("chuẩn hoá: sắp theo articleIdx, nhãn mặc định, null cho trường tuỳ chọn", () => {
    const manifest = parseManifest(valid());
    const [doc] = manifest.documents;
    expect(doc.articles.map((a) => a.articleIdx)).toEqual([7, 8]);
    expect(doc.articles[0].label).toBe("Nhãn riêng");
    expect(doc.articles[1].label).toBe(defaultArticleLabel("Nội quy", 8));
    expect(doc.articles[1].label).toBe("Nội quy – Điều 8");
    expect(doc.sourceFileName).toBeNull();
    expect(manifest.note).toBeNull();
    expect(manifest.suggestions).toEqual(["Câu gợi ý?"]);
  });

  it("gom mọi vấn đề vào một lần báo", () => {
    const bad = {
      documents: [
        {
          documentCode: "noi quy",
          documentTitle: "",
          shortName: "Nội quy",
          articles: [
            { articleIdx: 1, title: "Điều 1", blocks: [] },
            { articleIdx: 1, title: "Điều 1 lặp", blocks: ["x"] },
            { articleIdx: -2, title: "Điều", blocks: ["x"] },
            { articleIdx: 3, title: "", blocks: ["  "] }
          ]
        },
        { documentCode: "NOI_QUY", documentTitle: "T", shortName: "S", articles: [] }
      ],
      suggestions: "không phải mảng"
    };
    let error: unknown;
    try {
      parseManifest(bad);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ArgumentInvalidException);
    const problems = (error as ArgumentInvalidException).metadata?.problems as string[];
    expect(problems.join("\n")).toEqual(
      expect.stringContaining('documentCode "noi quy" chỉ gồm A-Z')
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"documentTitle"'),
        expect.stringContaining('"blocks" phải là mảng có ít nhất 1 đoạn'),
        expect.stringContaining("trùng articleIdx 1"),
        expect.stringContaining('"articleIdx" phải là số nguyên không âm'),
        expect.stringContaining('"blocks" có đoạn rỗng'),
        expect.stringContaining('"articles" phải là mảng có ít nhất 1 mục'),
        expect.stringContaining('"suggestions" phải là mảng chuỗi')
      ])
    );
    expect(problems.length).toBeGreaterThanOrEqual(7);
  });

  it("từ chối trùng documentCode, không phải object, thiếu documents", () => {
    const dup = valid();
    dup.documents.push({ ...dup.documents[0] });
    expect(() => parseManifest(dup)).toThrow(/trùng documentCode "NOI_QUY"/);
    expect(() => parseManifest("abc")).toThrow(ArgumentInvalidException);
    expect(() => parseManifest({})).toThrow(/"documents" phải là mảng/);
  });

  it("giới hạn số câu gợi ý", () => {
    const tooMany = { ...valid(), suggestions: Array.from({ length: 13 }, (_, i) => `Câu ${i}?`) };
    expect(() => parseManifest(tooMany)).toThrow(/tối đa 12 câu/);
  });
});

describe("HandbookAssistantError", () => {
  it("mang mã hợp đồng, status HTTP và thông điệp mặc định", () => {
    const error = new HandbookAssistantError("QUOTA_EXCEEDED");
    expect(isHandbookAssistantError(error)).toBe(true);
    expect(error.errorCode).toBe("QUOTA_EXCEEDED");
    expect(error.code).toBe("HANDBOOK.QUOTA_EXCEEDED");
    expect(error.statusCode).toBe(429);
    expect(error.message).toBeTruthy();
    expect(new HandbookAssistantError("BAD_REQUEST", "Câu hỏi quá dài").message).toBe(
      "Câu hỏi quá dài"
    );
    expect(isHandbookAssistantError(new Error("x"))).toBe(false);
  });
});

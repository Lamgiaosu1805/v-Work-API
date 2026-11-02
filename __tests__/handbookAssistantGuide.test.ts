import fs from "fs";
import path from "path";
import { mergeSuggestions, parseGuideMarkdown } from "../scripts/handbook/lib/guide-markdown";
import { parseManifest } from "../src/modules/handbook-assistant";
import {
  LEAVE_MULTI_APPROVAL_MIN_DAYS,
  RequestEntity
} from "../src/modules/request/domain/request.entity";
import {
  INFO_REQUEST_CATALOG,
  RESOLUTION_LABELS,
  URGENCY_LABELS
} from "../src/modules/ticket/domain/ticket-catalog";
import {
  TicketApprovalRequiredError,
  TicketForbiddenError,
  TicketInvalidTransitionError,
  TicketNotEligibleError,
  TicketReopenNotAllowedError,
  TicketVersionConflictError
} from "../src/modules/ticket/domain/ticket.errors";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ALLOWED_EXTENSIONS } = require("../src/middlewares/uploadTicket");

const OPTIONS = {
  documentCode: "HUONG_DAN_DON_TU",
  documentTitle: "Hướng dẫn đơn từ",
  shortName: "Hướng dẫn đơn từ",
  sourceFileName: "guide.md"
};

describe("parseGuideMarkdown", () => {
  const sample = `# Tiêu đề tài liệu

<!-- chú thích
nhiều dòng -->

## Mục 1. Tổng quan
Đoạn một.
- Gạch đầu dòng hai.
Đoạn ba có "dấu ngoặc".

## Mục 2. Chi tiết
Nội dung mục hai.

## Câu hỏi gợi ý
Hỏi thứ nhất?
- Hỏi thứ hai?
`;

  it("tách mục, khối, nhãn trích dẫn và câu hỏi gợi ý", () => {
    const { documents, suggestions } = parseGuideMarkdown(sample, OPTIONS);
    expect(documents).toHaveLength(1);
    expect(documents[0].articles.map((a) => [a.articleIdx, a.title, a.label])).toEqual([
      [1, "Tổng quan", "Hướng dẫn đơn từ – Mục 1"],
      [2, "Chi tiết", "Hướng dẫn đơn từ – Mục 2"]
    ]);
    expect(documents[0].articles[0].blocks).toEqual([
      "Đoạn một.",
      "Gạch đầu dòng hai.",
      'Đoạn ba có "dấu ngoặc".'
    ]);
    expect(suggestions).toEqual(["Hỏi thứ nhất?", "Hỏi thứ hai?"]);
  });

  it("kết quả qua được bộ đọc manifest của bước nạp", () => {
    const parsed = parseGuideMarkdown(sample, OPTIONS);
    const manifest = parseManifest({ note: null, ...parsed });
    expect(manifest.documents[0].articles[1].blocks).toEqual(["Nội dung mục hai."]);
  });

  it.each([
    ["số mục không liên tục", "## Mục 1. A\nx\n## Mục 3. B\ny", /"Mục 3" phải là "Mục 2"/],
    ["nội dung ngoài mục", "Lạc đề\n## Mục 1. A\nx", /nằm ngoài mục nào/],
    ["mục rỗng", "## Mục 1. A\n## Mục 2. B\ny", /Mục 1 không có nội dung/],
    ["tiêu đề cấp 3", "## Mục 1. A\nx\n### Con\ny", /tiêu đề không được hỗ trợ/],
    ["không có mục", "# Chỉ có tiêu đề", /Không có mục nào/]
  ])("báo lỗi khi %s", (_name, markdown, message) => {
    expect(() => parseGuideMarkdown(markdown, OPTIONS)).toThrow(message);
  });
});

describe("mergeSuggestions", () => {
  it("giữ gợi ý cũ trước, thêm gợi ý mới, bỏ trùng", () => {
    expect(mergeSuggestions(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("báo lỗi khi vượt giới hạn thay vì tự cắt", () => {
    const many = Array.from({ length: 10 }, (_v, i) => `q${i}`);
    expect(() => mergeSuggestions(many, ["x", "y", "z"], 12)).toThrow(/tối đa 12/);
  });
});

// File hướng dẫn nằm trong repo là nguồn nạp cho Trợ lý Nội quy: kiểm tra nó luôn hợp lệ và các con số
// then chốt khớp với code của luồng đơn từ (đổi code mà quên sửa tài liệu thì test này báo).
describe("docs/HUONG-DAN-DON-TU.md", () => {
  const markdown = fs.readFileSync(path.resolve(__dirname, "../docs/HUONG-DAN-DON-TU.md"), "utf8");
  const parsed = parseGuideMarkdown(markdown, OPTIONS);
  const { articles } = parsed.documents[0];
  const text = (idx: number) => articles[idx - 1].blocks.join("\n");

  it("qua bộ đọc manifest, mỗi khối đủ ngắn để trích dẫn gọn", () => {
    expect(() => parseManifest({ note: null, ...parsed })).not.toThrow();
    expect(articles).toHaveLength(12);
    const longest = Math.max(...articles.flatMap((a) => a.blocks.map((b) => b.length)));
    expect(longest).toBeLessThanOrEqual(700);
    expect(parsed.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it("ngưỡng duyệt nhiều cấp trong tài liệu khớp với RequestEntity", () => {
    const make = (requestType: string, extra: Record<string, unknown>) =>
      RequestEntity.create({
        userId: "u1",
        requestType: requestType as never,
        reason: "x",
        ...extra
      });

    expect(LEAVE_MULTI_APPROVAL_MIN_DAYS).toBe(2);
    expect(make("leave", { total_days: 1.5 }).needsMultiApproval()).toBe(false);
    expect(make("leave", { total_days: 2 }).needsMultiApproval()).toBe(true);
    expect(text(3)).toMatch(/Nghỉ phép dưới 2 ngày/);
    expect(text(3)).toMatch(/Nghỉ phép từ 2 ngày trở lên/);

    expect(make("late_early", { occurrence: 3 }).needsMultiApproval()).toBe(false);
    expect(make("late_early", { occurrence: 4 }).needsMultiApproval()).toBe(true);
    expect(text(3)).toMatch(/từ đơn thứ 4/);

    expect(make("forgot_checkin", { occurrence: 5 }).needsMultiApproval()).toBe(false);
    expect(make("forgot_checkin", { occurrence: 6 }).needsMultiApproval()).toBe(true);
    expect(text(3)).toMatch(/từ lần quên thứ 6/);

    ["remote", "business_trip", "client_visit"].forEach((type) =>
      expect(make(type, { total_days: 5 }).needsMultiApproval()).toBe(false)
    );
  });

  it("nêu đủ 9 loại đơn trên form và các quy tắc nhập chung", () => {
    const create = text(2);
    [
      "Quên chấm công",
      "Nghỉ phép",
      "Nghỉ không lương",
      "Nghỉ dài hạn",
      "Đi muộn",
      "Về sớm",
      "Đi công tác",
      "Đi gặp gỡ khách hàng",
      "Làm việc từ xa"
    ].forEach((label) => expect(create).toContain(label));
    expect(create).toMatch(/tối đa 100 ký tự/);
  });
});

// Hướng dẫn Ticket hỗ trợ: nhãn trạng thái / kết quả / checklist / giới hạn file phải khớp code, và KHÔNG ghi cứng
// số cấu hình được (ngưỡng "Cần chú ý", số ngày tự đóng / mở lại) — các số đó trợ lý lấy từ khối cấu hình đang áp
// dụng (ticket-guide-summary.service.ts).
describe("docs/HUONG-DAN-TICKET.md", () => {
  const markdown = fs.readFileSync(path.resolve(__dirname, "../docs/HUONG-DAN-TICKET.md"), "utf8");
  const parsed = parseGuideMarkdown(markdown, {
    ...OPTIONS,
    documentCode: "HUONG_DAN_TICKET",
    shortName: "Hướng dẫn ticket"
  });
  const { articles } = parsed.documents[0];
  const text = (idx: number) => articles[idx - 1].blocks.join("\n");
  const content = articles.flatMap((a) => a.blocks).join("\n");
  const title = (idx: number) => articles[idx - 1].title;
  // Thứ tự mục (đổi bố cục thì sửa các chỉ số dưới đây): 1 mở ở đâu, 2 quyền, 3 khi nào gửi, 6 mức khẩn, 7 file,
  // 8 ví dụ, 10 trạng thái / kết quả, 12 yêu cầu bổ sung, 19 thông báo lỗi.

  it("qua bộ đọc manifest, mỗi khối đủ ngắn để trích dẫn gọn", () => {
    expect(() => parseManifest({ note: null, ...parsed })).not.toThrow();
    expect(articles).toHaveLength(19);
    const longest = Math.max(...articles.flatMap((a) => a.blocks.map((b) => b.length)));
    expect(longest).toBeLessThanOrEqual(900);
    expect(parsed.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it("đúng thứ tự các mục mà các kiểm tra dưới đây dựa vào", () => {
    expect(title(2)).toMatch(/quyền/i);
    expect(title(6)).toMatch(/mức khẩn/i);
    expect(title(7)).toMatch(/file đính kèm/i);
    expect(title(10)).toMatch(/Trạng thái/);
    expect(title(12)).toMatch(/bổ sung/i);
    expect(title(19)).toMatch(/lỗi/i);
  });

  it("giữ nhỏ: mỗi nghìn token ở đây cộng vào MỌI câu hỏi (bản hiệu lực đã sát ngưỡng 100 nghìn token)", () => {
    // ~1,9 byte / token trên văn bản này (đo bằng count_tokens 11/2026): 28000 byte ≈ 15 nghìn token (hiện ~27,3 nghìn byte).
    const bytes = Buffer.byteLength(articles.flatMap((a) => [a.title, ...a.blocks]).join("\n"));
    expect(bytes).toBeLessThanOrEqual(28000);
  });

  it("không ghi cứng số cấu hình được (thời lượng theo ngày / giờ làm việc)", () => {
    expect(content).not.toMatch(/\d+\s*(ngày|giờ|phút)( làm việc)?/);
  });

  it("không có câu tham chiếu kiểu xem Mục N (trợ lý sẽ đọc nguyên văn ra cho người dùng)", () => {
    expect(content).not.toMatch(/xem\s+Mục\s+\d+/i);
    expect(content).not.toMatch(/Theo\s+Mục\s+\d+/i);
  });

  it("nhãn mức khẩn, kết quả đóng và mục bổ sung khớp danh mục của module ticket", () => {
    Object.values(URGENCY_LABELS).forEach((label) => expect(text(6)).toContain(label));
    Object.values(RESOLUTION_LABELS).forEach((label) => expect(text(10)).toContain(`"${label}"`));
    INFO_REQUEST_CATALOG.forEach((item) => expect(text(12)).toContain(item.label));
  });

  it("giới hạn file khớp middleware upload", () => {
    ALLOWED_EXTENSIONS.forEach((ext: string) => expect(text(7)).toContain(ext));
    expect(text(7)).toMatch(/tối đa 25MB/);
    expect(text(7)).toMatch(/tối đa 10 file/);
  });

  it("thông báo lỗi trích nguyên văn đúng câu của backend", () => {
    [
      TicketVersionConflictError.defaultMessage,
      TicketApprovalRequiredError.defaultMessage,
      TicketReopenNotAllowedError.defaultMessage,
      TicketInvalidTransitionError.defaultMessage,
      TicketNotEligibleError.defaultMessage,
      TicketForbiddenError.defaultMessage
    ].forEach((message) => expect(text(19)).toContain(message));
  });

  // Quyền / role nêu trong hướng dẫn phải khớp seed (đổi tên role ở seed mà quên sửa tài liệu thì test báo).
  it("tên role và quyền nêu ở mục Quyền khớp seed role ticket và role nhân viên cơ bản", () => {
    const seed = fs.readFileSync(
      path.resolve(__dirname, "../scripts/seedPermissionTicketRoles.ts"),
      "utf8"
    );
    const roleNames = [...seed.matchAll(/name: "([^"]+)"/g)].map((match) => match[1]);
    expect(roleNames).toHaveLength(3);
    roleNames.forEach((name) => expect(text(2)).toContain(name));
    expect(text(2)).toContain("Nhân viên cơ bản");
    const baseline = fs.readFileSync(
      path.resolve(__dirname, "../scripts/seedPermissionEmployeeBaselineRole.ts"),
      "utf8"
    );
    expect(baseline).toMatch(/permissionCode: "ticket\.create"/);
    expect(baseline).not.toMatch(/permissionCode: "ticket\.handle"/);
  });

  it("nêu cách mở theo quyền CRM, hai mẫu của nhóm tình huống hồ sơ vay và hai ví dụ ticket", () => {
    expect(text(1)).toContain("CSKH & Call Center");
    expect(text(1)).toContain("Workplace");
    expect(text(3)).toContain("Lỗi hệ thống");
    expect(text(3)).toContain("Hồ sơ vay đang xử lý bị vướng");
    expect(text(8)).toContain("Ví dụ 1");
    expect(text(8)).toContain("Ví dụ 2");
  });
});

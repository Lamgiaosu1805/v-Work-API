jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import {
  formatTicketGuideSummary,
  formatWorkingDuration,
  TicketGuideSummary
} from "../../../src/modules/ticket/application/ticket-guide-summary.service";
import type {
  CategoryDef,
  ProductDef,
  TemplateDef
} from "../../../src/modules/ticket/application/ticket-config.types";
import { createHandbookReferenceContext } from "../../../src/workflows/handbook-reference-context.workflow";
/* eslint-enable import/first */

const created = new Date("2026-10-01T00:00:00Z");

const product = (over: Partial<ProductDef>): ProductDef => ({
  id: "p",
  code: "p",
  name: "P",
  group: "",
  appCode: null,
  description: "",
  handlerIds: ["secret-handler"],
  isActive: true,
  createdAt: created,
  ...over
});

const category = (over: Partial<CategoryDef>): CategoryDef => ({
  id: "c",
  code: "c",
  name: "C",
  description: "",
  handlerIds: [],
  isActive: true,
  createdAt: created,
  ...over
});

const template = (over: Partial<TemplateDef>): TemplateDef => ({
  id: "t",
  code: "t",
  name: "T",
  categoryId: "c1",
  titlePattern: "",
  fields: [],
  requiredDocuments: [],
  requiresApproval: false,
  defaultUrgency: "normal",
  handlerIds: ["secret-handler"],
  guidance: "",
  isActive: true,
  createdAt: created,
  ...over
});

function summary(over: Partial<TicketGuideSummary> = {}): TicketGuideSummary {
  return {
    settings: {
      policy: {
        workdayMinutes: 480,
        unclaimedMinutes: { urgent: 30, high: 60, normal: 240, low: 480 },
        silentMinutes: { urgent: 480, high: 960, normal: 2400, low: 4800 },
        holdUnknownDays: 5,
        autoCloseResolvedDays: 3,
        autoCloseWaitingInfoDays: 3,
        reopenDays: 3
      },
      calendar: {
        workStartMinute: 480,
        workEndMinute: 1020,
        workDays: [1, 2, 3, 4, 5, 6],
        dayWindows: { 6: { startMinute: 480, endMinute: 720 } }
      },
      defaultHandlerIds: ["secret-default"]
    },
    products: [
      product({ id: "p1", name: "TIKLUY APP", group: "TIKLUY", appCode: "tikluy" }),
      product({ id: "p2", name: "CRM", group: "vWork" })
    ],
    categories: [category({ id: "c1", name: "Thay đổi thông tin khách" })],
    templates: [
      template({
        name: "Đổi số điện thoại",
        fields: [
          {
            key: "old_phone",
            label: "SĐT cũ",
            type: "phone",
            required: true,
            placeholder: "",
            help: "",
            options: [],
            appCodes: []
          },
          {
            key: "investment_code",
            label: "Mã khoản đầu tư",
            type: "text",
            required: false,
            placeholder: "",
            help: "",
            options: [],
            appCodes: ["tikluy"]
          }
        ],
        requiredDocuments: [
          { kind: "cccd_images", label: "CCCD 2 mặt", required: true, sensitive: true }
        ],
        requiresApproval: true,
        guidance: "Dòng một.\nDòng hai."
      }),
      // Mẫu thuộc loại đã tắt / xoá → không nêu
      template({ name: "Mẫu mồ côi", categoryId: "c-off" })
    ],
    ...over
  };
}

describe("formatWorkingDuration", () => {
  it.each([
    [30, "30 phút làm việc"],
    [60, "1 giờ làm việc"],
    [270, "4 giờ 30 phút làm việc"],
    [480, "1 ngày làm việc"],
    [540, "1 ngày 1 giờ làm việc"],
    [2400, "5 ngày làm việc"],
    [0, "0 phút làm việc"]
  ])("%i phút (ngày 480 phút) → %s", (minutes, expected) => {
    expect(formatWorkingDuration(minutes, 480)).toBe(expected);
  });
});

describe("formatTicketGuideSummary", () => {
  const text = formatTicketGuideSummary(summary());

  it("nêu ngưỡng theo từng mức khẩn bằng giờ / ngày làm việc", () => {
    expect(text).toContain(
      "- Chưa ai nhận quá: Khẩn 30 phút làm việc; Cao 1 giờ làm việc; Bình thường 4 giờ làm việc; Thấp 1 ngày làm việc."
    );
    expect(text).toContain(
      "- Đang xử lý mà không có cập nhật quá: Khẩn 1 ngày làm việc; Cao 2 ngày làm việc; Bình thường 5 ngày làm việc; Thấp 10 ngày làm việc."
    );
    expect(text).toMatch(/Tạm hoãn không có ngày dự kiến.*5 ngày làm việc/);
  });

  it("nêu lịch làm việc (gộp ngày cùng khung giờ) và độ dài 1 ngày làm việc", () => {
    expect(text).toContain("Thứ 2, Thứ 3, Thứ 4, Thứ 5, Thứ 6: 08:00–17:00; Thứ 7: 08:00–12:00");
    expect(text).toContain('"1 ngày làm việc" được tính bằng 8 giờ làm việc');
  });

  it("nêu tự đóng và hạn mở lại", () => {
    expect(text).toMatch(/"Đã xử lý".*"Đã giải quyết" sau 3 ngày làm việc/);
    expect(text).toMatch(/"Chờ bổ sung".*"Người tạo không bổ sung" sau 3 ngày làm việc/);
    expect(text).toMatch(/Mở lại ticket đã đóng.*trong 3 ngày làm việc/);
  });

  it("nêu sản phẩm, loại và mẫu đang dùng; bỏ mẫu thuộc loại không còn dùng", () => {
    expect(text).toContain("TIKLUY APP (nhóm TIKLUY), CRM (nhóm vWork)");
    expect(text).toContain("Loại yêu cầu đang dùng: Thay đổi thông tin khách.");
    expect(text).toContain("Mẫu yêu cầu đang dùng (1 mẫu):");
    expect(text).not.toContain("Mẫu mồ côi");
    const line = text.split("\n").find((l) => l.includes("Đổi số điện thoại")) as string;
    expect(line).toContain("loại yêu cầu: Thay đổi thông tin khách");
    expect(line).toContain("mức khẩn của mẫu: Bình thường");
    expect(line).toContain("thông tin bắt buộc: SĐT cũ");
    expect(line).toContain("Mã khoản đầu tư (chỉ với TIKLUY)");
    expect(line).toContain("CCCD 2 mặt (bắt buộc, nhạy cảm)");
    expect(line).toContain("bắt buộc tờ trình có chữ ký");
    expect(line).toContain("hướng dẫn của mẫu: Dòng một. Dòng hai.");
  });

  it("tất định và không lộ người phụ trách (nằm trong prompt cache dùng chung)", () => {
    expect(formatTicketGuideSummary(summary())).toBe(text);
    expect(text).not.toMatch(/secret/);
  });
});

describe("createHandbookReferenceContext", () => {
  it("giữ bản đã đọc trong thời gian cache, hết hạn thì đọc lại", async () => {
    let clock = 0;
    const load = jest.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    const provider = createHandbookReferenceContext(load, 1000, () => clock);

    expect(await provider.getCurrent()).toEqual({ ticketConfig: "v1" });
    clock = 999;
    expect(await provider.getCurrent()).toEqual({ ticketConfig: "v1" });
    clock = 1000;
    expect(await provider.getCurrent()).toEqual({ ticketConfig: "v2" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("nhiều câu hỏi cùng lúc chỉ đọc DB một lần", async () => {
    const load = jest.fn().mockResolvedValue("v");
    const provider = createHandbookReferenceContext(load);
    await Promise.all([provider.getCurrent(), provider.getCurrent(), provider.getCurrent()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lỗi đọc → ticketConfig null, không cache lỗi (lần sau đọc lại)", async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce("v");
    const provider = createHandbookReferenceContext(load);
    expect(await provider.getCurrent()).toEqual({ ticketConfig: null });
    expect(await provider.getCurrent()).toEqual({ ticketConfig: "v" });
  });
});

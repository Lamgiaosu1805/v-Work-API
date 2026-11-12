import {
  deadlineOf,
  isReportDay,
  periodRanges,
  reportDaysBetween,
  submissionStatus
} from "../src/modules/daily-report/domain/report-calendar";
import {
  completionRatio,
  monthlyTarget,
  shortfall,
  suggestedDailyTarget
} from "../src/modules/daily-report/domain/kpi-progress";
import {
  manualMetrics,
  plannableMetrics,
  templateMetrics
} from "../src/modules/daily-report/domain/kpi-metrics";
import { DailyReportEntity } from "../src/modules/daily-report/domain/daily-report.entity";
import { ArgumentInvalidException, ForbiddenException } from "../src/core/exceptions/exceptions";

// Giờ Việt Nam = UTC+7
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("report-calendar", () => {
  test("ngày / lũy kế tháng / lũy kế năm tính theo giờ Việt Nam, tới hết ngày đang xem", () => {
    const ranges = periodRanges("2026-11-12");
    expect(ranges.day.from).toEqual(vn("2026-11-12T00:00:00"));
    expect(ranges.day.to).toEqual(vn("2026-11-13T00:00:00"));
    expect(ranges.month.from).toEqual(vn("2026-11-01T00:00:00"));
    expect(ranges.month.to).toEqual(vn("2026-11-13T00:00:00"));
    expect(ranges.year.from).toEqual(vn("2026-01-01T00:00:00"));
  });

  test("hạn kế hoạch 09:30, kết quả 17:30", () => {
    expect(deadlineOf("2026-11-12", "plan")).toEqual(vn("2026-11-12T09:30:00"));
    expect(deadlineOf("2026-11-12", "result")).toEqual(vn("2026-11-12T17:30:00"));
  });

  test("báo cáo thứ Hai → thứ Bảy, trừ Chủ nhật và ngày lễ", () => {
    const holidays = new Set(["2026-11-10"]);
    expect(isReportDay("2026-11-14", holidays)).toBe(true); // thứ Bảy
    expect(isReportDay("2026-11-15", holidays)).toBe(false); // Chủ nhật
    expect(isReportDay("2026-11-10", holidays)).toBe(false); // ngày lễ
    expect(reportDaysBetween("2026-11-09", "2026-11-15", holidays)).toEqual([
      "2026-11-09",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14"
    ]);
  });

  test.each([
    ["nộp trước hạn", vn("2026-11-12T17:00:00"), vn("2026-11-12T18:00:00"), true, "on_time"],
    ["nộp sau hạn", vn("2026-11-12T17:31:00"), vn("2026-11-12T18:00:00"), true, "late"],
    ["chưa nộp, chưa tới hạn", null, vn("2026-11-12T16:00:00"), true, "pending"],
    ["chưa nộp, quá hạn trong ngày", null, vn("2026-11-12T18:00:00"), true, "overdue"],
    ["qua ngày chưa nộp", null, vn("2026-11-13T08:00:00"), true, "missing"],
    ["không phải nộp", null, vn("2026-11-13T08:00:00"), false, "not_required"]
  ])("trạng thái kết quả: %s", (_label, submittedAt, now, required, expected) => {
    expect(
      submissionStatus({
        submittedAt: submittedAt as Date | null,
        dateKey: "2026-11-12",
        kind: "result",
        now: now as Date,
        required: required as boolean
      })
    ).toBe(expected);
  });
});

describe("kpi-progress", () => {
  test("KH tháng: theo phân bổ 12 tháng, thiếu thì chia đều KH năm", () => {
    expect(monthlyTarget({ annual: 120 }, 11)).toBe(10);
    const monthly = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50, 15];
    expect(monthlyTarget({ annual: 120, monthly }, 11)).toBe(50);
    expect(monthlyTarget({ annual: 120, monthly: [5] }, 11)).toBe(10);
  });

  test("% hoàn thành và số còn thiếu", () => {
    expect(completionRatio(50, 200)).toBe(0.25);
    expect(completionRatio(50, 0)).toBeNull();
    expect(completionRatio(50, null)).toBeNull();
    expect(shortfall(50, 200)).toBe(150);
    expect(shortfall(250, 200)).toBe(0);
    expect(shortfall(50, null)).toBeNull();
  });

  test("cần đạt hôm nay = phần còn thiếu của tháng / số ngày phải báo cáo còn lại", () => {
    expect(
      suggestedDailyTarget({ monthTarget: 100, doneBeforeToday: 40, reportDaysLeft: 15 })
    ).toBe(4);
    expect(
      suggestedDailyTarget({ monthTarget: 100, doneBeforeToday: 120, reportDaysLeft: 5 })
    ).toBe(0);
    expect(
      suggestedDailyTarget({ monthTarget: null, doneBeforeToday: 0, reportDaysLeft: 5 })
    ).toBeNull();
    expect(
      suggestedDailyTarget({ monthTarget: 100, doneBeforeToday: 0, reportDaysLeft: 0 })
    ).toBeNull();
  });
});

describe("kpi-metrics", () => {
  test("bộ TTKD: Sale nhập tay chỉ tiêu chưa có dữ liệu, đặt mục tiêu cho cả chỉ tiêu tự động", () => {
    expect(manualMetrics("TTKD")).toEqual([
      "merchant_sale",
      "ctv_new",
      "merchant_active",
      "consult_meeting",
      "roadshow",
      "other_task"
    ]);
    expect(plannableMetrics("TTKD")).toContain("investment_amount");
    expect(plannableMetrics("TTKD")).not.toContain("compliance");
  });

  test("bộ Priority: không có chỉ tiêu nhập tay, tái tục chưa có dữ liệu", () => {
    expect(templateMetrics("PRIORITY")).toEqual([
      "investment_amount",
      "cif_first_investment",
      "renewal_rate",
      "compliance"
    ]);
    expect(manualMetrics("PRIORITY")).toEqual([]);
    expect(plannableMetrics("PRIORITY")).toEqual(["investment_amount", "cif_first_investment"]);
  });
});

describe("DailyReportEntity", () => {
  const newReport = () =>
    DailyReportEntity.create("6560a0000000000000000001", {
      appId: "6560a0000000000000000002",
      employeeId: "6560a0000000000000000003",
      departmentId: null,
      reportDate: "2026-11-12"
    });
  const manual = manualMetrics("TTKD");
  const plannable = plannableMetrics("TTKD");

  test("lưu kế hoạch: giữ giờ nộp lần đầu khi sửa lại", () => {
    const report = newReport();
    report.savePlan(
      { targets: [{ metric_code: "cif_new", value: 2 }], note: " Gọi 40 KH " },
      plannable,
      vn("2026-11-12T08:00:00")
    );
    report.savePlan(
      { targets: [{ metric_code: "cif_new", value: 3 }], note: null },
      plannable,
      vn("2026-11-12T10:00:00")
    );
    const { plan } = report.getProps();
    expect(plan.submittedAt).toEqual(vn("2026-11-12T08:00:00"));
    expect(plan.updatedAt).toEqual(vn("2026-11-12T10:00:00"));
    expect(plan.targets).toEqual([{ metricCode: "cif_new", value: 3, note: null }]);
  });

  test("không sửa kế hoạch sau giờ chốt 17:30", () => {
    expect(() =>
      newReport().savePlan({ targets: [], note: null }, plannable, vn("2026-11-12T17:31:00"))
    ).toThrow(ForbiddenException);
  });

  test("chỉ báo cáo cho ngày hôm nay", () => {
    expect(() =>
      newReport().savePlan({ targets: [], note: null }, plannable, vn("2026-11-13T08:00:00"))
    ).toThrow(ArgumentInvalidException);
  });

  test("kết quả: nộp trước hạn thì sửa được tới 17:30, sau đó khoá", () => {
    const report = newReport();
    const input = {
      values: [{ metric_code: "roadshow", value: 1 }],
      achievements: "Ký 2 CTV",
      blockers: null,
      proposals: null
    };
    report.submitResult(input, manual, vn("2026-11-12T17:00:00"));
    report.submitResult({ ...input, achievements: "Ký 3 CTV" }, manual, vn("2026-11-12T17:20:00"));
    expect(report.getProps().result.achievements).toBe("Ký 3 CTV");
    expect(report.getProps().result.submittedAt).toEqual(vn("2026-11-12T17:00:00"));
    expect(() => report.submitResult(input, manual, vn("2026-11-12T17:40:00"))).toThrow(
      ForbiddenException
    );
  });

  test("kết quả: chưa nộp thì vẫn nộp muộn được trong ngày, sau đó khoá", () => {
    const report = newReport();
    const input = { values: [], achievements: null, blockers: null, proposals: null };
    report.submitResult(input, manual, vn("2026-11-12T20:00:00"));
    expect(report.getProps().result.submittedAt).toEqual(vn("2026-11-12T20:00:00"));
    expect(() => report.submitResult(input, manual, vn("2026-11-12T20:05:00"))).toThrow(
      ForbiddenException
    );
  });

  test.each([
    ["chỉ tiêu tự động không được nhập tay", [{ metric_code: "investment_amount", value: 1 }]],
    ["giá trị âm", [{ metric_code: "roadshow", value: -1 }]],
    ["giá trị không phải số", [{ metric_code: "roadshow", value: "abc" }]],
    [
      "nhập trùng",
      [
        { metric_code: "roadshow", value: 1 },
        { metric_code: "roadshow", value: 2 }
      ]
    ]
  ])("kết quả không hợp lệ: %s", (_label, values) => {
    expect(() =>
      newReport().submitResult(
        { values, achievements: null, blockers: null, proposals: null },
        manual,
        vn("2026-11-12T16:00:00")
      )
    ).toThrow(ArgumentInvalidException);
  });
});

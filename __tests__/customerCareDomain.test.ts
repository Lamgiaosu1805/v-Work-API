import { WorkingCalendar, toVnDateKey } from "../src/modules/customer-care/domain/working-calendar";
import {
  buildCarePolicy,
  classifyCustomer,
  validateCarePolicy
} from "../src/modules/customer-care/domain/care-policy";
import { CustomerAssignmentEntity } from "../src/modules/customer-care/domain/customer-assignment.entity";
import { CustomerCareStateEntity } from "../src/modules/customer-care/domain/customer-care-state.entity";
import { SaleAllocationProfileEntity } from "../src/modules/customer-care/domain/sale-allocation-profile.entity";
import {
  isSaleFull,
  pickSaleRoundRobin,
  remainingCapacity,
  SaleCandidate
} from "../src/modules/customer-care/domain/allocation";

// 2026-10-07 là thứ Tư. Mọi giờ viết theo giờ Việt Nam.
const vn = (local: string) => new Date(`${local}:00+07:00`);

describe("WorkingCalendar", () => {
  const calendar = new WorkingCalendar({ holidays: ["2026-10-09"] }); // thứ Sáu nghỉ lễ

  it("cộng phút trong cùng ca", () => {
    expect(calendar.addWorkingMinutes(vn("2026-10-07T09:00"), 30)).toEqual(vn("2026-10-07T09:30"));
  });

  it("đồng hồ dừng sau 17:00 và chạy tiếp từ 8:00 ngày làm việc kế tiếp", () => {
    expect(calendar.addWorkingMinutes(vn("2026-10-07T16:50"), 30)).toEqual(vn("2026-10-08T08:20"));
  });

  it("khách vào ngoài giờ: SLA bắt đầu đầu ca kế tiếp, bỏ qua ngày lễ và cuối tuần", () => {
    // Thứ Năm 18:00 → thứ Sáu nghỉ lễ → T7, CN → thứ Hai 12/10 8:05
    expect(calendar.addWorkingMinutes(vn("2026-10-08T18:00"), 5)).toEqual(vn("2026-10-12T08:05"));
  });

  it("trước giờ làm trong ngày làm việc → bắt đầu 8:00 cùng ngày", () => {
    expect(calendar.nextWorkingStart(vn("2026-10-07T06:30"))).toEqual(vn("2026-10-07T08:00"));
  });

  it("đếm phút làm việc giữa hai mốc qua đêm", () => {
    expect(calendar.workingMinutesBetween(vn("2026-10-07T16:00"), vn("2026-10-08T09:00"))).toBe(
      120
    );
  });

  it("dateKey theo giờ VN", () => {
    expect(toVnDateKey(new Date("2026-10-06T18:00:00Z"))).toBe("2026-10-07");
  });
});

describe("care-policy", () => {
  it("phân nhóm theo trạng thái", () => {
    expect(classifyCustomer({ kycVerified: true, hasInvestment: false })).toBe("A");
    expect(classifyCustomer({ kycVerified: false, hasInvestment: false })).toBe("B");
    expect(classifyCustomer({ kycVerified: true, hasInvestment: true })).toBeNull();
  });

  it("policy mặc định hợp lệ, phát hiện cấu hình sai", () => {
    expect(validateCarePolicy(buildCarePolicy("tikluy"))).toEqual([]);
    const bad = buildCarePolicy("tikluy", {
      sla: { A: { revokeMinutes: 10 } } as never
    });
    expect(validateCarePolicy(bad)).toContain(
      "Nhóm A: mốc thu hồi không được sớm hơn mốc cảnh báo"
    );
  });
});

describe("CustomerAssignmentEntity", () => {
  const calendar = new WorkingCalendar();
  const policy = buildCarePolicy("tikluy", { enabled: true });
  const assign = (overrides: Partial<Parameters<typeof CustomerAssignmentEntity.assign>[0]> = {}) =>
    CustomerAssignmentEntity.assign(
      {
        id: "a1",
        customerId: "c1",
        appId: "app1",
        saleId: "s1",
        round: 1,
        channel: "auto",
        priorityClass: "A",
        assignedAt: vn("2026-10-07T09:00"),
        assignedBy: null,
        ...overrides
      },
      policy,
      calendar
    );

  it("nhóm A: hạn 5', cảnh báo phút 15, thu hồi phút 30", () => {
    const props = assign().getProps();
    expect(props.firstContactDueAt).toEqual(vn("2026-10-07T09:05"));
    expect(props.warnAt).toEqual(vn("2026-10-07T09:15"));
    expect(props.revokeAt).toEqual(vn("2026-10-07T09:30"));
    expect(props.inactivityDueAt).toEqual(vn("2026-10-08T09:00"));
  });

  it("không liên hệ: cảnh báo một lần rồi thu hồi", () => {
    const a = assign();
    expect(a.evaluate(vn("2026-10-07T09:10"))).toBeNull();
    expect(a.evaluate(vn("2026-10-07T09:15"))).toBe("warn_no_contact");
    a.markWarned("no_contact", vn("2026-10-07T09:15"));
    expect(a.evaluate(vn("2026-10-07T09:20"))).toBeNull();
    expect(a.evaluate(vn("2026-10-07T09:30"))).toBe("revoke_no_contact");
  });

  it("gọi trễ hạn vẫn được ghi nhận liên hệ nhưng bị đánh dấu vi phạm SLA", () => {
    const a = assign();
    a.recordContactAttempt({ at: vn("2026-10-07T09:08"), answerSec: 0 }, policy, calendar);
    expect(a.getProps().firstContactBreached).toBe(true);
    expect(a.evaluate(vn("2026-10-07T09:40"))).toBeNull();
  });

  it("cuộc gọi nghe máy dưới ngưỡng không phải hoạt động hợp lệ; đủ ngưỡng thì gia hạn", () => {
    const a = assign();
    expect(
      a.recordContactAttempt({ at: vn("2026-10-07T09:02"), answerSec: 5 }, policy, calendar)
    ).toBe(false);
    expect(a.getProps().lastValidActivityAt).toBeNull();
    expect(
      a.recordContactAttempt({ at: vn("2026-10-07T14:00"), answerSec: 45 }, policy, calendar)
    ).toBe(true);
    expect(a.getProps().inactivityDueAt).toEqual(vn("2026-10-08T14:00"));
  });

  it("chưa kết nối nhưng gọi đủ 3 lần thì tính là chăm sóc hợp lệ", () => {
    const a = assign();
    a.recordContactAttempt({ at: vn("2026-10-07T09:01"), answerSec: 0 }, policy, calendar);
    a.recordContactAttempt({ at: vn("2026-10-07T11:00"), answerSec: 0 }, policy, calendar);
    expect(
      a.recordContactAttempt({ at: vn("2026-10-07T15:00"), answerSec: 0 }, policy, calendar)
    ).toBe(true);
    expect(a.getProps().lastValidActivityAt).toEqual(vn("2026-10-07T15:00"));
  });

  it("không có hoạt động hợp lệ quá hạn → thu hồi; lịch hẹn gia hạn mốc", () => {
    const a = assign();
    a.recordContactAttempt({ at: vn("2026-10-07T09:01"), answerSec: 0 }, policy, calendar);
    expect(a.evaluate(vn("2026-10-08T09:00"))).toBe("revoke_inactive");

    const b = assign();
    b.recordCareReport(
      { at: vn("2026-10-07T09:03"), appointmentAt: vn("2026-10-12T10:00") },
      policy,
      calendar
    );
    expect(b.evaluate(vn("2026-10-09T16:00"))).toBeNull();
    expect(b.evaluate(vn("2026-10-12T12:00"))).toBe("revoke_inactive");
  });

  it("khách có mã Sale chỉ bị cảnh báo, không tự thu hồi", () => {
    const a = assign({ channel: "referral" });
    expect(a.evaluate(vn("2026-10-07T10:00"))).toBe("warn_no_contact");
    a.markWarned("no_contact", vn("2026-10-07T10:00"));
    expect(a.evaluate(vn("2026-10-07T11:00"))).toBeNull();
  });

  it("eKYC giữa chừng B → A: siết mốc tính từ lúc đổi, không phạt hồi tố", () => {
    const a = assign({ priorityClass: "B" });
    expect(a.getProps().revokeAt).toEqual(vn("2026-10-07T10:00"));
    a.reclassify("A", vn("2026-10-07T09:10"), policy, calendar);
    const props = a.getProps();
    expect(props.priorityClass).toBe("A");
    expect(props.firstContactDueAt).toEqual(vn("2026-10-07T09:15"));
    expect(props.revokeAt).toEqual(vn("2026-10-07T09:40"));
  });

  it("đã kết thúc thì không đánh giá và không nhận thêm hoạt động", () => {
    const a = assign();
    a.end("converted", vn("2026-10-07T10:00"), null, null);
    expect(a.evaluate(vn("2026-10-09T10:00"))).toBeNull();
    expect(() =>
      a.recordContactAttempt({ at: vn("2026-10-07T11:00"), answerSec: 60 }, policy, calendar)
    ).toThrow("Lượt giao khách đã kết thúc");
  });
});

describe("CustomerCareStateEntity", () => {
  const at = vn("2026-10-07T09:00");

  it("thu hồi vòng 1 → về Pool, nhớ Sale cũ; vòng 2 → chuyển CSKH nhóm C", () => {
    const state = CustomerCareStateEntity.create({
      id: "st1",
      customerId: "c1",
      appId: "app1",
      priorityClass: "A",
      at
    });
    expect(state.assign("a1", "s1")).toBe(1);
    expect(state.release(at, 2, "revoked_no_contact")).toBe("in_pool");
    expect(state.previousSaleIds).toEqual(["s1"]);

    expect(state.assign("a2", "s2")).toBe(2);
    expect(state.release(at, 2, "revoked_inactive")).toBe("nurturing");
    expect(state.priorityClass).toBe("C");

    state.returnToPool(at, "B", "Khách có nhu cầu mới");
    expect(state.poolStatus).toBe("in_pool");
    expect(state.roundCount).toBe(0);
  });

  it("không giao khi khách đang có Sale", () => {
    const state = CustomerCareStateEntity.create({
      id: "st1",
      customerId: "c1",
      appId: "app1",
      priorityClass: "B",
      at
    });
    state.assign("a1", "s1");
    expect(() => state.assign("a2", "s2")).toThrow("Khách đang có Sale phụ trách");
  });
});

describe("SaleAllocationProfileEntity", () => {
  it("tạm dừng có thời hạn tự hết hiệu lực; khoá thì không", () => {
    const now = vn("2026-10-07T09:00");
    const profile = SaleAllocationProfileEntity.createDefault("p1", "s1", "C");
    profile.pause("Xử lý khách tồn", vn("2026-10-08T08:00"), "acc1", now);
    expect(profile.isAccepting(vn("2026-10-07T12:00"))).toBe(false);
    expect(profile.isAccepting(vn("2026-10-08T08:00"))).toBe(true);
    profile.lock("Nghỉ dài ngày", "acc1", now);
    expect(profile.isAccepting(vn("2026-12-01T08:00"))).toBe(false);
    expect(() => profile.pause("  ", null, "acc1", now)).toThrow("Vui lòng nhập lý do tạm dừng");
  });
});

describe("pickSaleRoundRobin", () => {
  const candidate = (saleId: string, overrides: Partial<SaleCandidate> = {}): SaleCandidate => ({
    saleId,
    capNewPerDay: 10,
    capTotal: 50,
    newToday: 0,
    activeLoad: 0,
    lastAssignedAt: null,
    ...overrides
  });

  it("ưu tiên Sale lâu nhất chưa được giao, bỏ Sale đã đủ và Sale từng giữ khách", () => {
    const picked = pickSaleRoundRobin(
      [
        candidate("s1", { lastAssignedAt: vn("2026-10-07T09:00") }),
        candidate("s2", { lastAssignedAt: vn("2026-10-07T08:00"), newToday: 10 }),
        candidate("s3", { lastAssignedAt: vn("2026-10-07T08:30") }),
        candidate("s4", { lastAssignedAt: null })
      ],
      ["s4"]
    );
    expect(picked?.saleId).toBe("s3");
  });

  it("trạng thái Đủ và số còn nhận được", () => {
    const c = candidate("s1", { newToday: 8, activeLoad: 49 });
    expect(isSaleFull(c)).toBe(false);
    expect(remainingCapacity(c)).toBe(1);
    expect(isSaleFull({ ...c, activeLoad: 50 })).toBe(true);
    expect(pickSaleRoundRobin([{ ...c, activeLoad: 50 }])).toBeNull();
  });
});

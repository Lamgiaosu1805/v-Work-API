const { RequestEntity } = require("../../../src/modules/request/domain/request.entity");

function newLongLeaveEntity(userId) {
  // total_days > 2 -> needsMultiApproval() === true (SRS "Nghỉ dài hạn": >2 ngày, không phải >3)
  return RequestEntity.create({
    userId,
    requestType: "leave",
    reason: "test",
    from_date: new Date("2026-01-05"),
    from_period: "morning",
    to_date: new Date("2026-01-10"),
    to_period: "afternoon",
    total_days: 4,
    leave_type: "paid",
    paid_days: 4,
    unpaid_days: 0
  });
}

function findRejectedEvent(entity) {
  return entity.domainEvents.find((e) => e.constructor.name === "RequestRejectedDomainEvent");
}

describe("RequestEntity.reject() — veto-1-người, giữ nguyên hành vi gốc (xem plan task 1.12)", () => {
  it("reject ngay lập tức dù chưa ai approve — overriddenApprovals rỗng", () => {
    const entity = newLongLeaveEntity("employee-1");
    entity.reject("reviewer-1", "không hợp lệ");

    expect(entity.status).toBe("rejected");
    expect(entity.approvals).toEqual([]);
    expect(findRejectedEvent(entity).overriddenApprovals).toEqual([]);
  });

  it("reject sau khi đã được 1/2 approve — KHÔNG bị chặn (veto 1 người, hành vi có sẵn từ code gốc), nhưng event mang theo overriddenApprovals", () => {
    const entity = newLongLeaveEntity("employee-1");
    entity.approve("reviewer-1", "");
    expect(entity.status).toBe("pending");
    expect(entity.approvals).toHaveLength(1);

    entity.reject("reviewer-2", "từ chối");

    expect(entity.status).toBe("rejected");
    // approval đã ghi nhận trước đó KHÔNG bị xoá khỏi entity — chỉ status đổi
    expect(entity.approvals).toHaveLength(1);

    const rejectedEvent = findRejectedEvent(entity);
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent.overriddenApprovals).toHaveLength(1);
    expect(rejectedEvent.overriddenApprovals[0].account).toBe("reviewer-1");
  });

  it("reject bởi chính người đã approve trước đó — vẫn cho phép (self-veto), overriddenApprovals ghi lại đúng approval của chính họ", () => {
    const entity = newLongLeaveEntity("employee-1");
    entity.approve("reviewer-1", "");

    entity.reject("reviewer-1", "đổi ý");

    expect(entity.status).toBe("rejected");
    expect(findRejectedEvent(entity).overriddenApprovals[0].account).toBe("reviewer-1");
  });
});

// LUỒNG PHÂN QUYỀN CHẤM CÔNG V-WORK (HCNS, 10/2026): "Nghỉ phép dưới 2 ngày: Quản lý trực tiếp phê
// duyệt" — từ 2 ngày trở lên cần 2 cấp (thay ngưỡng "> 2 ngày" của SRS v2.0). Khoá đúng ngưỡng biên.
describe("RequestEntity — ngưỡng đa duyệt nghỉ phép (từ 2 ngày) và approvalMode()", () => {
  function newLeaveEntity(totalDays) {
    return RequestEntity.create({
      userId: "employee-1",
      requestType: "leave",
      reason: "test",
      from_date: new Date("2026-01-05"),
      from_period: "morning",
      to_date: new Date("2026-01-05"),
      to_period: "afternoon",
      total_days: totalDays,
      leave_type: "paid",
      paid_days: totalDays,
      unpaid_days: 0
    });
  }

  it("total_days = 1.5: chỉ quản lý trực tiếp duyệt (direct_only, 1 lượt)", () => {
    const entity = newLeaveEntity(1.5);
    expect(entity.needsMultiApproval()).toBe(false);
    expect(entity.approvalMode()).toBe("direct_only");
    expect(entity.requiredApprovals(2)).toBe(1);
  });

  it("total_days = 2: cần 2 cấp, duyệt tuần tự (sequential)", () => {
    const entity = newLeaveEntity(2);
    expect(entity.needsMultiApproval()).toBe(true);
    expect(entity.approvalMode()).toBe("sequential");
    expect(entity.requiredApprovals(2)).toBe(2);
  });

  it("đa cấp nhưng chuỗi chỉ có 1 người: 1 lượt là đủ; chưa biết chuỗi: vẫn 2 lượt như cũ", () => {
    const entity = newLeaveEntity(5);
    expect(entity.requiredApprovals(1)).toBe(1);
    expect(entity.requiredApprovals(0)).toBe(2);
    expect(entity.requiredApprovals()).toBe(2);
  });
});

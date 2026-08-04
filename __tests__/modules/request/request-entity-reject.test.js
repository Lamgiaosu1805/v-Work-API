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

// Người dùng chốt (sau khi đối chiếu lại SRS v2.0, 03/08/2026): ngưỡng đa duyệt của "Nghỉ dài hạn" là
// "> 2 ngày", KHÔNG phải "> 3 ngày" như code cũ — khoá đúng ngưỡng biên để không bị lệch lại.
describe("RequestEntity.needsMultiApproval() — ngưỡng 'Nghỉ dài hạn' đúng SRS (> 2 ngày)", () => {
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

  it("total_days = 2: chỉ cần 1 cấp (không needsMultiApproval)", () => {
    expect(newLeaveEntity(2).needsMultiApproval()).toBe(false);
  });

  it("total_days = 3: cần 2 cấp (needsMultiApproval) — trước đây (ngưỡng >3 cũ) sẽ là false, giờ phải true", () => {
    expect(newLeaveEntity(3).needsMultiApproval()).toBe(true);
  });
});

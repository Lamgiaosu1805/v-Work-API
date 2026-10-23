import { TicketEntity, CreateTicketInput } from "../../../src/modules/ticket/domain/ticket.entity";
import {
  TicketAlreadyClaimedError,
  TicketApprovalRequiredError,
  TicketForbiddenError,
  TicketInvalidTransitionError,
  TicketNoteRequiredError,
  TicketNotEligibleError,
  TicketReopenNotAllowedError
} from "../../../src/modules/ticket/domain/ticket.errors";

const REQUESTER = "emp-requester";
const IT_A = "emp-it-a";
const IT_B = "emp-it-b";
const IT_C = "emp-it-c";
const BOSS = "emp-boss";

const T0 = new Date("2026-10-23T09:00:00+07:00");
const minutesLater = (minutes: number) => new Date(T0.getTime() + minutes * 60 * 1000);

function baseInput(overrides: Partial<CreateTicketInput> = {}): CreateTicketInput {
  return {
    code: "TK-2610-0001",
    title: "Khách không nhận được OTP",
    productId: "product-tikluy-app",
    categoryId: "category-account",
    createdBy: REQUESTER,
    ...overrides
  };
}

function newTicket(overrides: Partial<CreateTicketInput> = {}): TicketEntity {
  return TicketEntity.create(baseInput(overrides), T0);
}

function inProgress(): TicketEntity {
  const ticket = newTicket();
  ticket.claim(IT_A, [], minutesLater(5));
  return ticket;
}

function eventNames(ticket: TicketEntity): string[] {
  return ticket.domainEvents.map((event) => event.constructor.name);
}

describe("TicketEntity.create", () => {
  it("tạo ticket thường ở trạng thái open, chưa có chủ trì", () => {
    const ticket = newTicket();
    const props = ticket.getProps();
    expect(props.status).toBe("open");
    expect(props.assignment.ownerId).toBeNull();
    expect(props.visibility).toBe("normal");
    expect(props.approval.status).toBe("not_required");
    expect(props.urgency).toBe("normal");
    expect(props.version).toBe(0);
    expect(eventNames(ticket)).toEqual(["TicketCreatedDomainEvent"]);
    expect(ticket.pullActivities().map((activity) => activity.action)).toEqual(["created"]);
  });

  it("từ chối tiêu đề rỗng", () => {
    expect(() => newTicket({ title: "   " })).toThrow();
  });

  it("giao đích danh nhiều người, chọn sẵn chủ trì → in_progress, còn lại là phối hợp", () => {
    const ticket = newTicket({
      assignment: {
        mode: "members",
        memberIds: [IT_A, IT_B, IT_C],
        ownerId: IT_B,
        assignedBy: BOSS
      }
    });
    const { assignment, status } = ticket.getProps();
    expect(status).toBe("in_progress");
    expect(assignment.ownerId).toBe(IT_B);
    expect(assignment.collaboratorIds.sort()).toEqual([IT_A, IT_C].sort());
    expect(eventNames(ticket)).toContain("TicketAssignedDomainEvent");
  });

  it("giao đích danh nhưng chưa chọn chủ trì → vẫn open, chưa có chủ trì", () => {
    const ticket = newTicket({ assignment: { mode: "members", memberIds: [IT_A, IT_B] } });
    expect(ticket.status).toBe("open");
    expect(ticket.ownerId).toBeNull();
  });

  it("chủ trì chọn sẵn phải nằm trong danh sách được giao", () => {
    expect(() =>
      newTicket({ assignment: { mode: "members", memberIds: [IT_A], ownerId: IT_B } })
    ).toThrow();
  });

  it("giao cho phòng ban phải có phòng ban", () => {
    expect(() => newTicket({ assignment: { mode: "department" } })).toThrow();
  });

  it("mẫu bắt buộc tờ trình, chưa đính kèm → waiting_info + ticket hạn chế", () => {
    const ticket = newTicket({ approvalRequired: true });
    const props = ticket.getProps();
    expect(props.status).toBe("waiting_info");
    expect(props.visibility).toBe("restricted");
    expect(props.approval).toMatchObject({ required: true, status: "missing", source: "template" });
    expect(props.infoRequest?.items[0].key).toBe("approval_document");
  });

  it("mẫu bắt buộc tờ trình và đã đính kèm lúc tạo → open, tờ trình submitted", () => {
    const ticket = newTicket({ approvalRequired: true, approvalDocumentProvided: true });
    expect(ticket.status).toBe("open");
    expect(ticket.getProps().approval.status).toBe("submitted");
    expect(ticket.getProps().visibility).toBe("restricted");
  });
});

describe("TicketEntity.claim — chống hai người cùng nhận", () => {
  it("người đầu tiên nhận thành chủ trì, ticket sang in_progress", () => {
    const ticket = newTicket();
    ticket.claim(IT_A, [], minutesLater(1));
    expect(ticket.status).toBe("in_progress");
    expect(ticket.ownerId).toBe(IT_A);
    expect(eventNames(ticket)).toContain("TicketClaimedDomainEvent");
  });

  it("ticket đã có chủ trì thì người sau nhận bị từ chối", () => {
    const ticket = newTicket();
    ticket.claim(IT_A);
    expect(() => ticket.claim(IT_B)).toThrow(TicketAlreadyClaimedError);
  });

  it("giao đích danh: người ngoài danh sách không nhận được", () => {
    const ticket = newTicket({ assignment: { mode: "members", memberIds: [IT_A, IT_B] } });
    expect(() => ticket.claim(IT_C)).toThrow(TicketNotEligibleError);
  });

  it("giao đích danh: người đầu tiên nhận thành chủ trì, người còn lại tự thành phối hợp", () => {
    const ticket = newTicket({ assignment: { mode: "members", memberIds: [IT_A, IT_B, IT_C] } });
    ticket.claim(IT_B);
    expect(ticket.getProps().assignment.collaboratorIds.sort()).toEqual([IT_A, IT_C].sort());
  });

  it("giao cho phòng ban: chỉ thành viên phòng đó nhận được", () => {
    const ticket = newTicket({ assignment: { mode: "department", departmentId: "dept-it" } });
    expect(() => ticket.claim(IT_A, ["dept-accounting"])).toThrow(TicketNotEligibleError);
    ticket.claim(IT_A, ["dept-it"]);
    expect(ticket.ownerId).toBe(IT_A);
  });

  it("không nhận được ticket đã đóng", () => {
    const ticket = inProgress();
    ticket.close({ code: "solved", by: IT_A, reopenUntil: null });
    expect(() => ticket.claim(IT_B)).toThrow();
  });
});

describe("TicketEntity — nhóm xử lý", () => {
  it("thêm người phối hợp; không thêm trùng chủ trì/phối hợp", () => {
    const ticket = inProgress();
    ticket.addCollaborator(IT_A, IT_B);
    expect(ticket.getProps().assignment.collaboratorIds).toEqual([IT_B]);
    expect(() => ticket.addCollaborator(IT_A, IT_B)).toThrow();
    expect(() => ticket.addCollaborator(IT_A, IT_A)).toThrow();
  });

  it("chủ trì trả lại: người phối hợp sớm nhất lên chủ trì", () => {
    const ticket = inProgress();
    ticket.addCollaborator(IT_A, IT_B);
    ticket.addCollaborator(IT_A, IT_C);
    ticket.release(IT_A, "Bận việc khác");
    expect(ticket.ownerId).toBe(IT_B);
    expect(ticket.getProps().assignment.collaboratorIds).toEqual([IT_C]);
    expect(ticket.status).toBe("in_progress");
  });

  it("chủ trì trả lại khi không còn ai → về open, bắt buộc ghi chú", () => {
    const ticket = inProgress();
    expect(() => ticket.release(IT_A, "")).toThrow(TicketNoteRequiredError);
    ticket.release(IT_A, "Không đủ quyền xử lý");
    expect(ticket.status).toBe("open");
    expect(ticket.ownerId).toBeNull();
  });

  it("người không phải chủ trì không trả lại được", () => {
    const ticket = inProgress();
    expect(() => ticket.release(IT_B, "x")).toThrow(TicketForbiddenError);
  });

  it("giao lại cho nhóm khác: reset chủ trì, về open nếu chưa chọn chủ trì", () => {
    const ticket = inProgress();
    ticket.assign({ mode: "members", memberIds: [IT_B, IT_C], assignedBy: BOSS });
    expect(ticket.status).toBe("open");
    expect(ticket.ownerId).toBeNull();
  });
});

describe("TicketEntity — bổ sung thông tin", () => {
  it("yêu cầu bổ sung → waiting_info; người tạo bổ sung xong → quay về in_progress", () => {
    const ticket = inProgress();
    ticket.requestInfo({
      items: [{ key: "attachment", label: "Ảnh chụp màn hình lỗi" }],
      requestedBy: IT_A
    });
    expect(ticket.status).toBe("waiting_info");
    ticket.submitInfo(REQUESTER);
    expect(ticket.status).toBe("in_progress");
    expect(ticket.getProps().infoRequest).toBeNull();
  });

  it("chỉ người tạo mới bổ sung được", () => {
    const ticket = inProgress();
    ticket.requestInfo({ items: [{ key: "x", label: "X" }], requestedBy: IT_A });
    expect(() => ticket.submitInfo(IT_B)).toThrow(TicketForbiddenError);
  });

  it("phải chọn ít nhất một mục cần bổ sung", () => {
    expect(() => inProgress().requestInfo({ items: [], requestedBy: IT_A })).toThrow();
  });

  it("yêu cầu tờ trình giữa chừng → ticket chuyển hạn chế và cần tờ trình", () => {
    const ticket = inProgress();
    ticket.requestInfo({
      items: [{ key: "approval_document", label: "Tờ trình có chữ ký" }],
      requestedBy: IT_A
    });
    const props = ticket.getProps();
    expect(props.visibility).toBe("restricted");
    expect(props.approval).toMatchObject({ required: true, status: "missing", source: "handler" });
  });

  it("đang chờ tờ trình thì không gửi bổ sung được nếu chưa tải tờ trình", () => {
    const ticket = newTicket({ approvalRequired: true });
    expect(() => ticket.submitInfo(REQUESTER)).toThrow();
    ticket.submitInfo(REQUESTER, {
      approvalSubmitted: true,
      approvalReference: { number: "TT-01", date: null, signer: "Giám đốc" }
    });
    expect(ticket.status).toBe("open");
    expect(ticket.getProps().approval.status).toBe("submitted");
  });
});

describe("TicketEntity — tờ trình", () => {
  function withSubmittedApproval(): TicketEntity {
    const ticket = newTicket({ approvalRequired: true, approvalDocumentProvided: true });
    ticket.claim(IT_A);
    return ticket;
  }

  it("chưa xác nhận tờ trình thì không kết luận 'Đã giải quyết'", () => {
    const ticket = withSubmittedApproval();
    expect(() => ticket.resolve({ by: IT_A })).toThrow(TicketApprovalRequiredError);
    expect(() => ticket.close({ code: "solved", by: IT_A, reopenUntil: null })).toThrow(
      TicketApprovalRequiredError
    );
  });

  it("tờ trình hợp lệ → xử lý xong được", () => {
    const ticket = withSubmittedApproval();
    ticket.verifyApproval(BOSS, true);
    ticket.resolve({ by: IT_A, note: "Đã đổi số điện thoại" });
    expect(ticket.status).toBe("resolved");
  });

  it("người tạo không được tự xác nhận tờ trình của mình", () => {
    const ticket = withSubmittedApproval();
    expect(() => ticket.verifyApproval(REQUESTER, true)).toThrow(TicketForbiddenError);
  });

  it("tờ trình không hợp lệ → trả về người tạo (waiting_info), bắt buộc ghi lý do", () => {
    const ticket = withSubmittedApproval();
    expect(() => ticket.verifyApproval(BOSS, false)).toThrow(TicketNoteRequiredError);
    ticket.verifyApproval(BOSS, false, "Thiếu chữ ký giám đốc");
    expect(ticket.status).toBe("waiting_info");
    expect(ticket.getProps().approval.status).toBe("invalid");
    expect(ticket.getProps().infoRequest?.items[0].note).toBe("Thiếu chữ ký giám đốc");
  });

  it("đóng với kết quả không giải quyết thì không cần tờ trình hợp lệ", () => {
    const ticket = withSubmittedApproval();
    ticket.close({
      code: "insufficient_basis",
      note: "Chưa đủ căn cứ",
      by: IT_A,
      reopenUntil: null
    });
    expect(ticket.status).toBe("closed");
  });
});

describe("TicketEntity — tạm hoãn", () => {
  it("tạm hoãn bắt buộc lý do, không bắt buộc ngày dự kiến", () => {
    const ticket = inProgress();
    expect(() => ticket.hold(IT_A, "  ")).toThrow(TicketNoteRequiredError);
    ticket.hold(IT_A, "Chờ ngân hàng phản hồi");
    expect(ticket.status).toBe("on_hold");
    expect(ticket.getProps().hold).toEqual({ reason: "Chờ ngân hàng phản hồi", resumeAt: null });
  });

  it("tiếp tục xử lý về in_progress, xoá thông tin tạm hoãn", () => {
    const ticket = inProgress();
    ticket.hold(IT_A, "Chờ dev release");
    ticket.resume(IT_A);
    expect(ticket.status).toBe("in_progress");
    expect(ticket.getProps().hold).toBeNull();
  });
});

describe("TicketEntity — kết luận, xác nhận, tự đóng", () => {
  it("xử lý xong → resolved; người tạo xác nhận → closed và không mở lại được nữa", () => {
    const ticket = inProgress();
    ticket.resolve({ by: IT_A, note: "Đã reset thiết bị", actionTaken: "Reset trên CMS TIKLUY" });
    expect(ticket.status).toBe("resolved");
    expect(ticket.getProps().resolution).toMatchObject({
      code: "solved",
      actionTaken: "Reset trên CMS TIKLUY"
    });

    ticket.confirm(REQUESTER, minutesLater(60));
    expect(ticket.status).toBe("closed");
    expect(ticket.getProps().confirmedByRequester).toBe(true);
    expect(() => ticket.reopen(REQUESTER, "Vẫn lỗi", minutesLater(90))).toThrow(
      TicketReopenNotAllowedError
    );
  });

  it("chỉ người tạo mới xác nhận được", () => {
    const ticket = inProgress();
    ticket.resolve({ by: IT_A });
    expect(() => ticket.confirm(IT_B)).toThrow(TicketForbiddenError);
  });

  it("'Cần theo dõi thêm' được lưu cùng kết quả xử lý", () => {
    const ticket = inProgress();
    const checkAt = new Date("2026-11-05T00:00:00+07:00");
    ticket.resolve({ by: IT_A, followUp: { note: "Kiểm tra kỳ lãi sau", checkAt } });
    expect(ticket.getProps().followUp).toEqual({ note: "Kiểm tra kỳ lãi sau", checkAt });
  });

  it("đóng không giải quyết bắt buộc lý do; trùng bắt buộc ticket gốc", () => {
    const ticket = inProgress();
    expect(() => ticket.close({ code: "wont_fix", by: IT_A, reopenUntil: null })).toThrow(
      TicketNoteRequiredError
    );
    expect(() => ticket.close({ code: "duplicate", by: IT_A, reopenUntil: null })).toThrow();
    ticket.close({ code: "duplicate", duplicateOf: "ticket-gốc", by: IT_A, reopenUntil: null });
    expect(ticket.getProps().duplicateOf).toBe("ticket-gốc");
  });

  it("kết quả 'người tạo không bổ sung' chỉ do hệ thống đặt", () => {
    expect(() =>
      inProgress().close({ code: "requester_no_response", by: IT_A, reopenUntil: null })
    ).toThrow();
  });

  it("tự đóng resolved → Đã giải quyết, vẫn mở lại được trong hạn", () => {
    const ticket = inProgress();
    ticket.resolve({ by: IT_A });
    const reopenUntil = minutesLater(3 * 24 * 60);
    ticket.autoClose(reopenUntil, minutesLater(100));
    expect(ticket.status).toBe("closed");
    expect(ticket.getProps().resolution?.code).toBe("solved");
    expect(ticket.getProps().confirmedByRequester).toBe(false);

    ticket.reopen(REQUESTER, "Chưa cộng lãi", minutesLater(200));
    expect(ticket.status).toBe("in_progress");
    expect(ticket.getProps().reopenCount).toBe(1);
    expect(ticket.getProps().resolution).toBeNull();
  });

  it("tự đóng waiting_info → 'Người tạo không bổ sung'", () => {
    const ticket = inProgress();
    ticket.requestInfo({ items: [{ key: "x", label: "X" }], requestedBy: IT_A });
    ticket.autoClose(null, minutesLater(100));
    expect(ticket.status).toBe("closed");
    expect(ticket.getProps().resolution?.code).toBe("requester_no_response");
  });

  it("không tự đóng được ticket đang xử lý", () => {
    expect(() => inProgress().autoClose(null)).toThrow(TicketInvalidTransitionError);
  });

  it("quá hạn mở lại thì không mở lại được (phải tạo ticket mới)", () => {
    const ticket = inProgress();
    ticket.resolve({ by: IT_A });
    ticket.autoClose(minutesLater(1000), minutesLater(100));
    expect(() => ticket.reopen(REQUESTER, "Vẫn lỗi", minutesLater(1001))).toThrow(
      TicketReopenNotAllowedError
    );
  });

  it("đang resolved thì mở lại không giới hạn thời gian; bắt buộc ghi chú", () => {
    const ticket = inProgress();
    ticket.resolve({ by: IT_A });
    expect(() => ticket.reopen(REQUESTER, "")).toThrow(TicketNoteRequiredError);
    ticket.reopen(REQUESTER, "Chưa ổn", minutesLater(10_000));
    expect(ticket.status).toBe("in_progress");
  });

  it("người ngoài (không phải người tạo/nhóm xử lý) không mở lại được", () => {
    const ticket = inProgress();
    ticket.resolve({ by: IT_A });
    expect(() => ticket.reopen("emp-stranger", "x")).toThrow(TicketForbiddenError);
  });
});

describe("TicketEntity — huỷ", () => {
  it("người tạo huỷ khi open, bắt buộc ghi chú", () => {
    const ticket = newTicket();
    expect(() => ticket.cancel(REQUESTER, "")).toThrow(TicketNoteRequiredError);
    ticket.cancel(REQUESTER, "Tạo nhầm");
    expect(ticket.status).toBe("cancelled");
  });

  it("không huỷ được khi đã có người xử lý", () => {
    expect(() => inProgress().cancel(REQUESTER, "Khách tự làm được")).toThrow(
      TicketInvalidTransitionError
    );
  });

  it("chỉ người tạo mới huỷ được", () => {
    expect(() => newTicket().cancel(IT_A, "x")).toThrow(TicketForbiddenError);
  });

  it("ticket đã huỷ không mở lại được", () => {
    const ticket = newTicket();
    ticket.cancel(REQUESTER, "Tạo nhầm");
    expect(() => ticket.reopen(REQUESTER, "x")).toThrow(TicketReopenNotAllowedError);
  });
});

describe("TicketEntity.edit", () => {
  it("người tạo sửa tiêu đề/mô tả và chỉ ghi nhận trường thực sự thay đổi", () => {
    const ticket = newTicket();
    const changes = ticket.edit({ title: "Sửa tiêu đề", description: "" }, "requester", REQUESTER);
    expect(changes.map((change) => change.field)).toEqual(["title"]);
    expect(ticket.getProps().title).toBe("Sửa tiêu đề");
  });

  it("không có thay đổi thì không ghi nhật ký", () => {
    const ticket = newTicket();
    ticket.pullActivities();
    expect(ticket.edit({ title: ticket.getProps().title }, "requester", REQUESTER)).toEqual([]);
    expect(ticket.pullActivities()).toEqual([]);
  });

  it("nhóm xử lý chỉ sửa được phân loại và mức khẩn; đổi mức khẩn bắt buộc ghi chú", () => {
    const ticket = inProgress();
    expect(() => ticket.edit({ title: "x" }, "group", IT_A)).toThrow(TicketForbiddenError);
    expect(() => ticket.edit({ urgency: "urgent" }, "group", IT_A)).toThrow(
      TicketNoteRequiredError
    );
    ticket.edit({ urgency: "urgent" }, "group", IT_A, "Khách bị khoá tài khoản");
    expect(ticket.getProps().urgency).toBe("urgent");
  });

  it("ticket đã đóng thì khoá sửa", () => {
    const ticket = inProgress();
    ticket.close({ code: "solved", by: IT_A, reopenUntil: null });
    expect(() => ticket.edit({ title: "x" }, "requester", REQUESTER)).toThrow(
      TicketInvalidTransitionError
    );
  });

  it("người tạo sửa sau khi đã có chủ trì → phát sự kiện báo chủ trì", () => {
    const ticket = inProgress();
    ticket.clearEvents();
    ticket.edit({ description: "Bổ sung chi tiết" }, "requester", REQUESTER);
    expect(eventNames(ticket)).toEqual(["TicketContentEditedDomainEvent"]);
  });
});

describe("TicketEntity — ngày hẹn, liên kết", () => {
  it("đặt ngày hẹn lần đầu không cần lý do; dời ngày phải ghi lý do và tăng số lần dời", () => {
    const ticket = inProgress();
    ticket.setDueHint(IT_A, new Date("2026-10-30T00:00:00+07:00"));
    expect(ticket.getProps().rescheduleCount).toBe(0);
    expect(() => ticket.setDueHint(IT_A, new Date("2026-11-02T00:00:00+07:00"))).toThrow(
      TicketNoteRequiredError
    );
    ticket.setDueHint(IT_A, new Date("2026-11-02T00:00:00+07:00"), "Chờ dev release");
    expect(ticket.getProps().rescheduleCount).toBe(1);
  });

  it("liên kết 'liên quan' không trùng và không tự liên kết với chính nó", () => {
    const ticket = newTicket();
    expect(() => ticket.linkRelated(IT_A, ticket.id)).toThrow();
    ticket.linkRelated(IT_A, "ticket-khác");
    ticket.linkRelated(IT_A, "ticket-khác");
    expect(ticket.getProps().relatedTicketIds).toEqual(["ticket-khác"]);
  });
});

describe("TicketEntity — statusChangedAt và nhắc nhở", () => {
  it("đổi trạng thái cập nhật statusChangedAt và xoá reminderSentAt", () => {
    const ticket = inProgress();
    ticket.requestInfo({ items: [{ key: "x", label: "X" }], requestedBy: IT_A }, minutesLater(30));
    expect(ticket.getProps().statusChangedAt).toEqual(minutesLater(30));
    ticket.markReminded(minutesLater(40));
    expect(ticket.getProps().reminderSentAt).toEqual(minutesLater(40));
    ticket.submitInfo(REQUESTER, {}, minutesLater(50));
    expect(ticket.getProps().reminderSentAt).toBeNull();
  });

  it("thao tác không đổi trạng thái giữ nguyên statusChangedAt nhưng cập nhật lastActivityAt", () => {
    const ticket = inProgress();
    const changedAt = ticket.getProps().statusChangedAt;
    ticket.recordActivity(IT_A, "message", undefined, minutesLater(120));
    expect(ticket.getProps().statusChangedAt).toEqual(changedAt);
    expect(ticket.getProps().lastActivityAt).toEqual(minutesLater(120));
  });
});

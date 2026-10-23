import {
  TicketApprovalVerifiedDomainEvent,
  TicketAssignedDomainEvent,
  TicketClaimedDomainEvent,
  TicketCollaboratorAddedDomainEvent,
  TicketCreatedDomainEvent,
  TicketInfoSubmittedDomainEvent,
  TicketStatusChangedDomainEvent
} from "../../../src/modules/ticket/domain/events/ticket.domain-events";
import {
  planNotifications,
  PolicyContext
} from "../../../src/modules/ticket/application/ticket-notification.policy";
import {
  buildListFilter,
  tabFilter,
  visibilityFilter
} from "../../../src/modules/ticket/application/ticket-query-filters";
import { capabilitiesOf } from "../../../src/modules/ticket/domain/ticket-capabilities";
import {
  contentTypeFor,
  parseListQuery,
  readPayload
} from "../../../src/modules/ticket/interface/ticket-request-parsers";
import { TicketActor } from "../../../src/modules/ticket/domain/types";

const ME = "emp-me";
const REQUESTER = "emp-requester";
const OWNER = "emp-owner";
const BOSS = "emp-boss";

function actor(overrides: Partial<TicketActor> = {}): TicketActor {
  return {
    employeeId: ME,
    departmentIds: ["dept-1"],
    canAssignDepartment: false,
    canAssignMember: false,
    canManage: false,
    canViewRestricted: false,
    canViewSensitive: false,
    ...overrides
  };
}

function context(
  overrides: Partial<PolicyContext["ticket"]["props"]> = {},
  rest: Partial<PolicyContext> = {}
): PolicyContext {
  return {
    ticket: {
      id: "t1",
      props: {
        code: "TK-2610-0001",
        title: "Khách không nhận OTP",
        createdBy: REQUESTER,
        status: "in_progress",
        infoRequest: null,
        assignment: {
          mode: "none",
          departmentId: null,
          memberIds: [],
          assignedBy: null,
          ownerId: OWNER,
          collaboratorIds: [],
          claimedAt: null
        },
        ...overrides
      }
    },
    urgentHandlerIds: ["handler-1", "handler-2"],
    departmentManagerId: "dept-manager",
    ...rest
  };
}

const recipients = (planned: ReturnType<typeof planNotifications>) =>
  planned.flatMap((item) => item.employeeIds);

describe("planNotifications — chỉ báo đúng người cần", () => {
  it("ticket Khẩn mới → người phụ trách; ticket thường → không báo ai", () => {
    const urgent = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: REQUESTER,
      urgency: "urgent"
    });
    expect(recipients(planNotifications(urgent, context()))).toEqual(["handler-1", "handler-2"]);

    const normal = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: REQUESTER,
      urgency: "normal"
    });
    expect(planNotifications(normal, context())).toEqual([]);
  });

  it("ticket Khẩn đang chờ người tạo bổ sung tờ trình thì chưa báo", () => {
    const urgent = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: REQUESTER,
      urgency: "urgent"
    });
    expect(planNotifications(urgent, context({ status: "waiting_info" }))).toEqual([]);
  });

  it("người phụ trách chính là người tạo thì không tự nhận thông báo của mình", () => {
    const urgent = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: "handler-1",
      urgency: "urgent"
    });
    expect(recipients(planNotifications(urgent, context()))).toEqual(["handler-2"]);
  });

  it("giao đích danh → những người được giao; giao phòng ban → chỉ trưởng phòng", () => {
    const toMembers = new TicketAssignedDomainEvent({
      aggregateId: "t1",
      actorId: BOSS,
      mode: "members",
      departmentId: null,
      memberIds: ["a", "b"]
    });
    expect(recipients(planNotifications(toMembers, context()))).toEqual(["a", "b"]);

    const toDepartment = new TicketAssignedDomainEvent({
      aggregateId: "t1",
      actorId: BOSS,
      mode: "department",
      departmentId: "dept-1",
      memberIds: []
    });
    expect(recipients(planNotifications(toDepartment, context()))).toEqual(["dept-manager"]);
  });

  it("có người nhận → báo người tạo; được thêm phối hợp → báo người được thêm", () => {
    expect(
      recipients(
        planNotifications(
          new TicketClaimedDomainEvent({ aggregateId: "t1", actorId: OWNER }),
          context()
        )
      )
    ).toEqual([REQUESTER]);
    expect(
      recipients(
        planNotifications(
          new TicketCollaboratorAddedDomainEvent({
            aggregateId: "t1",
            actorId: OWNER,
            collaboratorId: "emp-new"
          }),
          context()
        )
      )
    ).toEqual(["emp-new"]);
  });

  it("người tạo bổ sung xong → báo chủ trì; chưa có chủ trì thì không báo ai", () => {
    const event = new TicketInfoSubmittedDomainEvent({ aggregateId: "t1", actorId: REQUESTER });
    expect(recipients(planNotifications(event, context()))).toEqual([OWNER]);
    const noOwner = context({
      assignment: { ...context().ticket.props.assignment, ownerId: null }
    });
    expect(planNotifications(event, noOwner)).toEqual([]);
  });

  it("tờ trình không hợp lệ → báo người tạo; hợp lệ → không báo", () => {
    expect(
      recipients(
        planNotifications(
          new TicketApprovalVerifiedDomainEvent({
            aggregateId: "t1",
            actorId: OWNER,
            valid: false
          }),
          context()
        )
      )
    ).toEqual([REQUESTER]);
    expect(
      planNotifications(
        new TicketApprovalVerifiedDomainEvent({ aggregateId: "t1", actorId: OWNER, valid: true }),
        context()
      )
    ).toEqual([]);
  });

  it("đã xử lý / đóng / tự đóng → báo người tạo; mở lại → báo chủ trì", () => {
    const status = (from: any, to: any, actorId: string | null, resolutionCode: any = null) =>
      new TicketStatusChangedDomainEvent({ aggregateId: "t1", actorId, from, to, resolutionCode });

    expect(
      recipients(planNotifications(status("in_progress", "resolved", OWNER), context()))
    ).toEqual([REQUESTER]);
    expect(
      recipients(planNotifications(status("in_progress", "closed", OWNER, "wont_fix"), context()))
    ).toEqual([REQUESTER]);

    const auto = planNotifications(status("resolved", "closed", null, "solved"), context());
    expect(auto[0].type).toBe("auto_closed");
    expect(auto[0].employeeIds).toEqual([REQUESTER]);

    expect(
      recipients(planNotifications(status("closed", "in_progress", REQUESTER), context()))
    ).toEqual([OWNER]);
  });

  it("đổi trạng thái không có trong bảng quy tắc (tạm hoãn, tiếp tục, trả lại) thì không báo", () => {
    const event = new TicketStatusChangedDomainEvent({
      aggregateId: "t1",
      actorId: OWNER,
      from: "in_progress",
      to: "on_hold"
    });
    expect(planNotifications(event, context())).toEqual([]);
  });
});

describe("buildListFilter", () => {
  const now = new Date("2026-10-26T09:00:00+07:00");

  it("ticket hạn chế chỉ hiện cho người liên quan, trừ người có quyền xem ticket hạn chế", () => {
    const filter = visibilityFilter(actor()) as { $or: Array<Record<string, unknown>> };
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { visibility: "normal" },
        { created_by: ME },
        { "assignment.owner_id": ME },
        { "assignment.collaborator_ids": ME },
        { "assignment.member_ids": ME }
      ])
    );
    expect(visibilityFilter(actor({ canViewRestricted: true }))).toEqual({});
  });

  it("tab 'unclaimed': chỉ ticket mình nhận được (không giao, giao mình, giao phòng mình)", () => {
    expect(tabFilter("unclaimed", actor(), now)).toMatchObject({
      status: "open",
      "assignment.owner_id": null,
      $or: expect.arrayContaining([
        { "assignment.mode": "none" },
        { "assignment.member_ids": ME },
        { "assignment.department_id": { $in: ["dept-1"] } }
      ])
    });
  });

  it("tab 'yellow': ticket còn xử lý dở và đã quá mốc cảnh báo", () => {
    expect(tabFilter("yellow", actor(), now)).toEqual({
      status: { $in: ["open", "in_progress", "on_hold"] },
      alert_at: { $lte: now }
    });
  });

  it("từ khoá được escape, các điều kiện gộp bằng $and để $or không đè nhau", () => {
    const filter = buildListFilter({ tab: "unclaimed", q: "a.b*(c" }, actor(), now) as {
      $and: Array<Record<string, any>>;
    };
    expect(Array.isArray(filter.$and)).toBe(true);
    const keywordPart = filter.$and.find((part) =>
      part.$or?.some((item: any) => item.code instanceof RegExp)
    );
    const regex = keywordPart!.$or[0].code as RegExp;
    expect(regex.test("xa.b*(cx")).toBe(true);
    expect(regex.test("xaXb")).toBe(false); // "." không còn là ký tự đại diện
  });

  it("lọc theo sản phẩm / mức khẩn / khoảng ngày", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const filter = buildListFilter({ productId: "p1", urgency: "urgent", from }, actor(), now) as {
      $and: Array<Record<string, any>>;
    };
    const direct = filter.$and.find((part) => part.product_id);
    expect(direct).toMatchObject({
      product_id: "p1",
      urgency: "urgent",
      createdAt: { $gte: from }
    });
  });
});

describe("capabilitiesOf", () => {
  const base = {
    status: "open" as const,
    createdBy: REQUESTER,
    assignment: {
      mode: "none" as const,
      departmentId: null,
      memberIds: [],
      assignedBy: null,
      ownerId: null,
      collaboratorIds: [],
      claimedAt: null
    },
    approval: {
      required: false,
      source: null,
      mode: "document" as const,
      status: "not_required" as const,
      reference: null,
      verifiedBy: null,
      verifiedAt: null,
      note: ""
    },
    confirmedByRequester: false,
    reopenUntil: null
  };

  it("ticket mới chưa ai nhận: ai cũng nhận được; người tạo sửa/huỷ được nhưng không đổi trạng thái xử lý", () => {
    const stranger = capabilitiesOf(base, actor());
    expect(stranger.claim).toBe(true);
    expect(stranger.resolve).toBe(false);
    expect(stranger.cancel).toBe(false);

    const requester = capabilitiesOf(base, actor({ employeeId: REQUESTER }));
    expect(requester).toMatchObject({ edit: true, cancel: true, resolve: false, close: false });
  });

  it("chủ trì và phối hợp có quyền như nhau; chủ trì mới được 'Trả lại' khi là chủ trì", () => {
    const ticket = {
      ...base,
      status: "in_progress" as const,
      assignment: { ...base.assignment, ownerId: OWNER, collaboratorIds: ["emp-collab"] }
    };
    const owner = capabilitiesOf(ticket, actor({ employeeId: OWNER }));
    const collaborator = capabilitiesOf(ticket, actor({ employeeId: "emp-collab" }));
    expect(owner).toMatchObject({ resolve: true, hold: true, requestInfo: true, release: true });
    expect(collaborator).toMatchObject({
      resolve: true,
      hold: true,
      requestInfo: true,
      release: false
    });
    expect(collaborator.claim).toBe(false);
  });

  it("đã xử lý: người tạo xác nhận/mở lại được; đã đóng sau hạn thì không mở lại được", () => {
    const resolved = { ...base, status: "resolved" as const };
    expect(capabilitiesOf(resolved, actor({ employeeId: REQUESTER }))).toMatchObject({
      confirm: true,
      reopen: true
    });

    const now = new Date("2026-10-26T09:00:00+07:00");
    const closed = {
      ...base,
      status: "closed" as const,
      reopenUntil: new Date("2026-10-28T09:00:00+07:00")
    };
    expect(capabilitiesOf(closed, actor({ employeeId: REQUESTER }), now).reopen).toBe(true);
    expect(
      capabilitiesOf(
        closed,
        actor({ employeeId: REQUESTER }),
        new Date("2026-10-29T09:00:00+07:00")
      ).reopen
    ).toBe(false);
    expect(
      capabilitiesOf(
        { ...closed, confirmedByRequester: true },
        actor({ employeeId: REQUESTER }),
        now
      ).reopen
    ).toBe(false);
  });

  it("xác nhận tờ trình: nhóm xử lý hoặc người có quyền xem hạn chế, không phải người tạo", () => {
    const ticket = {
      ...base,
      status: "in_progress" as const,
      assignment: { ...base.assignment, ownerId: OWNER },
      approval: { ...base.approval, required: true, status: "submitted" as const }
    };
    expect(capabilitiesOf(ticket, actor({ employeeId: OWNER })).verifyApproval).toBe(true);
    expect(
      capabilitiesOf(ticket, actor({ employeeId: BOSS, canViewRestricted: true })).verifyApproval
    ).toBe(true);
    expect(capabilitiesOf(ticket, actor({ employeeId: REQUESTER })).verifyApproval).toBe(false);
  });

  it("giao việc: cần quyền giao phòng hoặc giao người", () => {
    expect(capabilitiesOf(base, actor()).assign).toBe(false);
    expect(capabilitiesOf(base, actor({ canAssignMember: true })).assign).toBe(true);
  });
});

describe("request parsers", () => {
  it("readPayload: multipart gửi JSON trong 'payload', JSON thường dùng body", () => {
    expect(readPayload({ body: { payload: '{"title":"A"}' } } as any)).toEqual({ title: "A" });
    expect(readPayload({ body: { title: "B" } } as any)).toEqual({ title: "B" });
    expect(() => readPayload({ body: { payload: "{hỏng" } } as any)).toThrow();
  });

  it("parseListQuery bỏ qua tab/urgency lạ", () => {
    const query = parseListQuery({
      tab: "hack",
      urgency: "x",
      status: "open,closed",
      q: " otp "
    } as any);
    expect(query).toMatchObject({
      tab: undefined,
      urgency: undefined,
      status: ["open", "closed"],
      q: "otp"
    });
  });

  it("contentTypeFor: chỉ định dạng an toàn mới xem trực tiếp; html/svg buộc tải về", () => {
    expect(contentTypeFor("a.PNG")).toEqual({ type: "image/png", inline: true });
    expect(contentTypeFor("a.pdf").inline).toBe(true);
    expect(contentTypeFor("evil.html")).toEqual({
      type: "application/octet-stream",
      inline: false
    });
    expect(contentTypeFor("evil.svg").inline).toBe(false);
    expect(contentTypeFor("file.xlsx").inline).toBe(false);
  });
});
